#!/usr/bin/env node
// scripts/plan/improve.mjs: the improvement dial and its resolver (spec 59).
//
// `Improve: off | gentle | steady | bold` in plan/bearings.md (`## Plan expansion posture`) sets the default of every
// expansion knob at once; absent reads as `gentle` (today's behaviour). A knob's own line (`Promote:`, `Support:`,
// `stall_action:`, `loop:`, `UI cadence:`, `Research:`, a non-empty `## Generators` list) overrides the dial for that
// knob only. Skills read knobs through this resolver and never grep bearings for them (scripts/__tests__/improve.test.mjs
// holds the named skills to it).
//
//   node scripts/plan/improve.mjs [--json] [--root <dir>]     # one line per knob: <knob> <value> (dial|override|var)
//   node scripts/plan/improve.mjs --get <knob> [--if-set]     # the bare value; --if-set prints nothing when only the
//                                                             # absent dial gave it (a workflow falling back to the dial)
//
// UI: the `UI:` line (none | url | dev) is the browser-walk TARGET and is not a dial knob. The dial's ui row is the audit
// CADENCE, read from `UI cadence:` (none | critique | iterate | both: the line the critique and iterate skills already
// read). The dial gives none / none / critique / iterate; a cadence walks only when `UI:` names something to walk.
//
// Variables: NEXUS_SUPPORT and NEXUS_CADENCE stay the cloud's source of truth for the knobs that live there. When one is
// set (and valid) in the environment (or an injected map) it WINS: the knob prints its value with source `var`,
// scripts/plan/support.mjs agrees (same precedence), and a variable that differs from what the dial and the override
// lines give is also a `warn:` line on stderr and, with --json, in `warnings`. A set but invalid variable is a warning
// and is ignored. The nudge workflow gates on `vars.NEXUS_SUPPORT` itself (a job `if` cannot read a file) and is not
// resolved here. Exit 0 always for a read: a disagreement is a note, never a failure (an unknown --get knob exits 2).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const POSITIONS = Object.freeze(['off', 'gentle', 'steady', 'bold']);
export const DEFAULT_POSITION = 'gentle';

/**
 * The dial table (spec 59, Design). Per knob: `registry` the spec 58 knob-registry row it maps to (null: not
 * registered yet), `line` the bearings key that overrides it, `var` the repo variable that mirrors it, `accepts` the
 * values the override line may carry (null: free form), `values` the value at each dial position.
 */
export const TABLE = Object.freeze([
  { knob: 'support', registry: 'Support', line: 'Support', var: 'NEXUS_SUPPORT', accepts: ['off', 'triage-only', 'fix-small', 'fix-all'],
    values: { off: 'off', gentle: 'triage-only', steady: 'fix-small', bold: 'fix-all' } },
  { knob: 'promote', registry: 'Promote', line: 'Promote', var: null, accepts: ['owner', 'aged', 'autonomous'],
    values: { off: 'owner', gentle: 'owner', steady: 'aged', bold: 'aged' } },
  { knob: 'generators', registry: 'Generators', line: null, var: null, accepts: null,
    values: { off: 'none', gentle: 'none', steady: 'generic', bold: 'generic+project' } },
  { knob: 'stall_action', registry: 'stall_action', line: 'stall_action', var: null, accepts: ['alert', 'promote', 'off'],
    values: { off: 'off', gentle: 'alert', steady: 'alert', bold: 'promote' } },
  { knob: 'loop', registry: 'loop', line: 'loop', var: null, accepts: ['on', 'off'],
    values: { off: 'off', gentle: 'off', steady: 'on', bold: 'on' } },
  { knob: 'ui', registry: 'UI cadence', line: 'UI cadence', var: null, accepts: ['none', 'critique', 'iterate', 'both'],
    values: { off: 'none', gentle: 'none', steady: 'critique', bold: 'iterate' } },
  { knob: 'research', registry: null, line: 'Research', var: null, accepts: ['off', 'monthly', 'weekly'],
    values: { off: 'off', gentle: 'off', steady: 'monthly', bold: 'weekly' } },
  { knob: 'cadence', registry: 'NEXUS_CADENCE', line: null, var: 'NEXUS_CADENCE', accepts: ['calm', 'steady', 'eager', 'sprint', 'off'],
    values: { off: 'calm', gentle: 'steady', steady: 'steady', bold: 'eager' } },
]);

const esc = (key) => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Bearings text with what is not prose removed: a BOM, HTML comments, fenced (``` or ~~~) code blocks, and indented
 * code blocks (four spaces or a tab after a blank line, unless the text above is a list item's continuation).
 */
function strip(text) {
  const lines = String(text ?? '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, '').split('\n');
  const out = [];
  let fence = null;
  let prevBlank = true;
  let inList = false;
  let inCode = false;
  for (const l of lines) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(l);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      out.push('');
      continue;
    }
    if (f) { fence = f[1]; out.push(''); continue; }
    const blank = !l.trim();
    if (!blank && /^( {4}|\t)/.test(l) && ((prevBlank && !inList) || inCode)) { inCode = true; out.push(''); prevBlank = false; continue; }
    inCode = false;
    if (!blank) inList = /^\s*(?:[-*+]|\d+[.)])\s/.test(l) || (inList && /^\s/.test(l));
    prevBlank = blank;
    out.push(l);
  }
  return out.join('\n');
}

/** A `## <name>` section of already-stripped text, up to the next heading of level 1 to 3: { body, rest } or null. */
function section(text, name) {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => new RegExp(`^##\\s+${esc(name)}\\b.*$`).test(l));
  if (at < 0) return null;
  const end = lines.findIndex((l, i) => i > at && /^#{1,3}\s/.test(l));
  const stop = end < 0 ? lines.length : end;
  return { body: lines.slice(at + 1, stop).join('\n'), rest: [...lines.slice(0, at), ...lines.slice(stop)].join('\n') };
}

/** Every `Key: value` line of the text: the value is the whole rest of the line, less trailing punctuation and a # comment. */
function values(text, key) {
  const re = new RegExp(`^[ \\t]*(?:[-*][ \\t]+)?[*\`]*${esc(key)}[*\`]*[ \\t]*:[*\`]*[ \\t]*[*\`]*([\\w-]+)[*\`]*[ \\t]*[.,;]*[ \\t]*(?:#.*)?$`, 'gmi');
  return [...text.matchAll(re)].map((m) => m[1]);
}

/**
 * The dial position from bearings text: { position, set, warnings }. Only a line inside `## Plan expansion posture`
 * counts (one outside is warned about and ignored); the first of several wins, with a warning. Absent or unreadable
 * reads as `gentle`.
 */
export function dial(bearings = '') {
  const text = strip(bearings);
  const sec = section(text, 'Plan expansion posture');
  const found = sec ? values(sec.body, 'Improve') : [];
  const warnings = [];
  if (values(sec ? sec.rest : text, 'Improve').length) warnings.push('Improve: outside ## Plan expansion posture is ignored; move it into that section');
  if (!found.length) return { position: DEFAULT_POSITION, set: false, warnings };
  if (found.length > 1) warnings.push(`more than one Improve: line (${found.join(', ')}); the first, ${found[0]}, wins`);
  const v = found[0].toLowerCase();
  if (POSITIONS.includes(v)) return { position: v, set: true, warnings };
  return { position: DEFAULT_POSITION, set: true, warnings: [...warnings, `Improve: ${found[0]} is not one of ${POSITIONS.join(' | ')}; read as ${DEFAULT_POSITION}`] };
}

/** The names a non-empty `## Generators` list carries (`- (none)` and empty lists are no override). */
export function generatorsListed(bearings = '') {
  const sec = section(strip(bearings), 'Generators');
  if (!sec) return [];
  return sec.body.split('\n')
    .map((l) => /^\s*(?:[-*]|\d+[.)])\s+`?([\w.-]+)`?\s*$/.exec(l)?.[1] ?? /^\s*(?:[-*]|\d+[.)])\s+`?([\w.-]+)`?[\s:(-]/.exec(l)?.[1])
    .filter((n) => n && n !== 'none');
}

/**
 * Every knob's effective value and source. `env` is the repo-variable map (NEXUS_SUPPORT, NEXUS_CADENCE); inject one,
 * or pass process.env. Returns { dial, set, knobs: [{ knob, value, source, dial }], warnings }.
 */
export function resolve(bearings = '', env = {}) {
  const d = dial(bearings);
  const text = strip(bearings);
  const warnings = [...d.warnings];
  const out = TABLE.map((t) => {
    const base = t.values[d.position];
    let value = base;
    let source = 'dial';
    if (t.knob === 'generators') {
      const names = generatorsListed(text);
      if (names.length) { value = names.join(','); source = 'override'; }
    } else if (t.line) {
      const m = values(text, t.line)[0];
      if (m) {
        const v = m.toLowerCase();
        if (!t.accepts || t.accepts.includes(v)) { value = v; source = 'override'; }
        else warnings.push(`${t.line}: ${m} is not one of ${t.accepts.join(' | ')}; the dial's ${base} stands`);
      }
    }
    if (t.var && env[t.var] != null && String(env[t.var]).trim() !== '') {
      const v = String(env[t.var]).trim().toLowerCase();
      if (t.accepts && !t.accepts.includes(v)) warnings.push(`${t.var}=${v} is not one of ${t.accepts.join(' | ')}; ignored`);
      else {
        if (v !== value) warnings.push(`${t.var}=${v} disagrees with ${t.knob} ${value} (${source}${source === 'dial' ? `, Improve: ${d.position}` : ''}); the variable wins in cloud, so set one to match the other`);
        value = v;
        source = 'var';
      }
    }
    return { knob: t.knob, value, source, dial: base };
  });
  return { dial: d.position, set: d.set, knobs: out, warnings };
}

/** The one-line form of a resolution: `<knob> <value> (dial|override|var)` per knob. */
export function lines(r) {
  return r.knobs.map((k) => `${k.knob} ${k.value} (${k.source})`);
}

export function main(argv = process.argv.slice(2), { root, env = process.env, log = console.log, err = console.error } = {}) {
  const at = argv.indexOf('--root');
  const base = at >= 0 ? path.resolve(argv[at + 1] ?? '.') : root ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const file = path.join(base, 'plan', 'bearings.md');
  const bearings = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const r = resolve(bearings, env);
  const get = argv.indexOf('--get');
  if (get >= 0) {
    const k = r.knobs.find((x) => x.knob === argv[get + 1]);
    if (!k) { err(`improve: unknown knob ${argv[get + 1] ?? ''} (${r.knobs.map((x) => x.knob).join(', ')})`); return 2; }
    if (!(argv.includes('--if-set') && k.source === 'dial' && !r.set)) log(k.value);
    return 0;
  }
  if (argv.includes('--json')) log(JSON.stringify(r, null, 2));
  else { log(`improve ${r.dial}${r.set ? '' : ' (absent: gentle)'}`); for (const l of lines(r)) log(l); }
  for (const w of r.warnings) err(`warn: ${w}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main();
