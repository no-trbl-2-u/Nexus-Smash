#!/usr/bin/env node
// scripts/plan/improve.mjs: the improvement dial and its resolver (spec 59).
//
// `Improve: off | gentle | steady | bold` in plan/bearings.md (`## Plan expansion posture`) sets the default of every
// expansion knob at once; absent reads as `gentle` (today's behaviour). A knob's own line (`Promote:`, `Support:`,
// `stall_action:`, `loop:`, `UI:`, `Research:`, a non-empty `## Generators` list) overrides the dial for that knob
// only. Skills read knobs through this resolver and never grep bearings for them.
//
//   node scripts/plan/improve.mjs [--json] [--root <dir>]     # one line per knob: <knob> <value> (dial|override)
//
// The repo variables NEXUS_SUPPORT and NEXUS_CADENCE stay the cloud's source of truth for the knobs that live there:
// the resolver reads them from the environment (or an injected map) and warns when one disagrees with the value the
// dial and the override lines give. The warning goes to stderr (a `warn:` line) and, with --json, to `warnings`.
// Exit 0 always: a disagreement is a note, never a failure.
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
  { knob: 'ui', registry: 'UI', line: 'UI', var: null, accepts: ['none', 'url', 'dev'],
    values: { off: 'none', gentle: 'none', steady: 'critique', bold: 'iterate' } },
  { knob: 'research', registry: null, line: 'Research', var: null, accepts: ['off', 'monthly', 'weekly'],
    values: { off: 'off', gentle: 'off', steady: 'monthly', bold: 'weekly' } },
  { knob: 'cadence', registry: 'NEXUS_CADENCE', line: null, var: 'NEXUS_CADENCE', accepts: ['calm', 'steady', 'eager'],
    values: { off: 'calm', gentle: 'steady', steady: 'steady', bold: 'eager' } },
]);

const strip = (text) => String(text ?? '').replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, '');
const lineRe = (key) => new RegExp(`^[ \\t]*(?:[-*][ \\t]+)?[*\`]*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[*\`]*[ \\t]*:[*\`]*[ \\t]*[*\`]*([^\\s*\`]+)`, 'mi');

/** The dial position from bearings text: { position, set, warnings }. Absent or unreadable reads as `gentle`. */
export function dial(bearings = '') {
  const m = lineRe('Improve').exec(strip(bearings));
  if (!m) return { position: DEFAULT_POSITION, set: false, warnings: [] };
  const v = m[1].toLowerCase();
  if (POSITIONS.includes(v)) return { position: v, set: true, warnings: [] };
  return { position: DEFAULT_POSITION, set: true, warnings: [`Improve: ${m[1]} is not one of ${POSITIONS.join(' | ')}; read as ${DEFAULT_POSITION}`] };
}

/** The names a non-empty `## Generators` list carries (`- (none)` and empty lists are no override). */
export function generatorsListed(bearings = '') {
  const lines = strip(bearings).split('\n');
  const at = lines.findIndex((l) => /^##\s+Generators\s*$/.test(l));
  if (at < 0) return [];
  const end = lines.findIndex((l, i) => i > at && /^##\s/.test(l));
  return lines.slice(at + 1, end < 0 ? lines.length : end)
    .map((l) => /^[-*]\s+`?([\w.-]+)`?/.exec(l)?.[1])
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
      const m = lineRe(t.line).exec(text);
      if (m) {
        const v = m[1].toLowerCase();
        if (!t.accepts || t.accepts.includes(v)) { value = v; source = 'override'; }
        else warnings.push(`${t.line}: ${m[1]} is not one of ${t.accepts.join(' | ')}; the dial's ${base} stands`);
      }
    }
    if (t.var && env[t.var] != null && String(env[t.var]).trim() !== '') {
      const v = String(env[t.var]).trim().toLowerCase();
      if (v !== value) warnings.push(`${t.var}=${v} disagrees with ${t.knob} ${value} (${source}${source === 'dial' ? `, Improve: ${d.position}` : ''}); the variable is the cloud's source of truth, so set one to match the other`);
    }
    return { knob: t.knob, value, source, dial: base };
  });
  return { dial: d.position, set: d.set, knobs: out, warnings };
}

/** The one-line form of a resolution: `<knob> <value> (dial|override)` per knob. */
export function lines(r) {
  return r.knobs.map((k) => `${k.knob} ${k.value} (${k.source})`);
}

export function main(argv = process.argv.slice(2), { root, env = process.env, log = console.log, err = console.error } = {}) {
  const at = argv.indexOf('--root');
  const base = at >= 0 ? path.resolve(argv[at + 1] ?? '.') : root ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const file = path.join(base, 'plan', 'bearings.md');
  const bearings = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const r = resolve(bearings, env);
  if (argv.includes('--json')) log(JSON.stringify(r, null, 2));
  else { log(`improve ${r.dial}${r.set ? '' : ' (absent: gentle)'}`); for (const l of lines(r)) log(l); }
  for (const w of r.warnings) err(`warn: ${w}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main();
