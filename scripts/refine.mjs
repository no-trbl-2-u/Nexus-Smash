#!/usr/bin/env node
// scripts/refine.mjs: the evidence context and the proposal check of /refine (spec 64.2, A2).
//
//   node scripts/refine.mjs <verb> [--k 2] [--dry] [--root <dir>]       # gate on the dial, write the context
//   node scripts/refine.mjs <verb> --check <proposal.json> [--root <dir>]  # validate a proposal against the context
//
// Only `Improve: bold` (scripts/plan/improve.mjs) proceeds; any lower dial prints one reason line and exits 0, writing
// nothing. The context lands as files under .scratch/refine/<verb>/context/ (gitignored): the verb's skill text, its
// last 3 closes from plan/ARCHIVE.md, the escape-ledger rows and open footguns that name it, the latest walk.json rows
// when the verb touches the GUI, and a mission.md of at most 20 lines naming every file. The proposer reads the
// mission and the files; nothing is inlined into its prompt. The model proposes; this script only enforces structure.
//
// A proposal is JSON, either `{ "answer": "KEEP_BASE", "reason": "..." }` (a valid answer on its own) or
// `{ "candidates": [{ "id", "lens": "inv" | "dom", "target", "edit", "evidence": "<file>:<line>" }, ...] }` with exactly
// --k (default 2) candidates per lens, each citing one file of the context dir and a line that exists in it.
// Exit: 0 gated off, written or valid; 1 invalid proposal; 2 usage.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve as resolveDial } from './plan/improve.mjs';

export const LENSES = Object.freeze(['inv', 'dom']);
export const CLOSES = 3;
export const MISSION_MAX = 20;
export const FILES = Object.freeze(['mission.md', 'skill.md', 'closes.md', 'escapes.md', 'footguns.md', 'walk.md']);

const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
const wordIn = (verb) => new RegExp(`(?:^|[^\\w-])(?:/|skills/)?${verb.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\.md)?(?![\\w-])`, 'i');
const slashIn = (verb) => new RegExp(`(?:/|skills/)${verb.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'i');

/** The skill file a verb names, or null: a lower-kebab verb with skills/<verb>.md, never refine itself. */
export function skillPath(root, verb) {
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(verb ?? '') || verb === 'refine') return null;
  const file = path.join(root, 'skills', `${verb}.md`);
  return fs.existsSync(file) ? file : null;
}

/** The context directory for a verb. */
export const contextDir = (root, verb) => path.join(root, '.scratch', 'refine', verb, 'context');

/** The latest .scratch/walk/<iso>/walk.json text under root, or ''. */
function latestWalk(root) {
  const dir = path.join(root, '.scratch', 'walk');
  if (!fs.existsSync(dir)) return '';
  const runs = fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, 'walk.json'))).sort();
  return runs.length ? read(path.join(dir, runs.at(-1), 'walk.json')) : '';
}

/** The evidence files of a verb as { name: text }, from the repo at root. Pure given the files. */
export function evidence(root, verb) {
  const skill = read(skillPath(root, verb) ?? '');
  const archive = read(path.join(root, 'plan', 'ARCHIVE.md')).split(/\r?\n/).filter((l) => /^- \d{4}-\d{2}-\d{2} · /.test(l));
  const closes = archive.filter((l) => slashIn(verb).test(l) || wordIn(verb).test(l.split(' · ')[3] ?? '')).slice(-CLOSES);
  const ledger = read(path.join(root, 'plan', 'eval', 'ledger.md')).split(/\r?\n/).filter((l) => /^[-|*]/.test(l.trim()) && wordIn(verb).test(l));
  const footguns = read(path.join(root, 'identity', 'footguns.md')).split(/\r?\n/);
  const open = [];
  let section = '';
  for (const l of footguns) {
    if (l.startsWith('## ')) section = /^## (\w+)/.exec(l)?.[1] ?? '';
    if (section === 'Open' && l.startsWith('- **') && wordIn(verb).test(l)) open.push(l);
  }
  const gui = /packages\/cli|walk\.json|\bGUI\b/.test(skill);
  const walk = gui ? latestWalk(root) : '';
  return {
    'skill.md': skill,
    'closes.md': closes.length ? `${closes.join('\n')}\n` : `(no close of /${verb} in plan/ARCHIVE.md yet)\n`,
    'escapes.md': ledger.length ? `${ledger.join('\n')}\n` : `(no escape-ledger row names /${verb}; plan/eval/ledger.md is spec 61.3's)\n`,
    'footguns.md': open.length ? `${open.join('\n')}\n` : `(no open footgun names /${verb})\n`,
    'walk.md': walk ? `${walk.trimEnd()}\n` : `(${gui ? 'no walk.json under .scratch/walk yet' : `/${verb} does not touch the GUI`})\n`,
  };
}

/** mission.md: the goal, the rules, the file list, the answer shape. At most MISSION_MAX lines, names every file. */
export function mission(verb, k = 2) {
  const lines = [
    `# Mission: refine /${verb}`,
    '',
    `Propose edits to skills/${verb}.md (and, for the dom lens, identity/footguns.md or the bearings knobs).`,
    'Read the files below first; grep them, do not ask for them inline.',
    '',
    ...FILES.filter((f) => f !== 'mission.md').map((f) => `- ${f}`),
    '',
    `Propose ${k} candidates per lens: inv (procedure: order, checks, stop conditions) and dom (domain: footguns, knobs).`,
    'Each candidate cites exactly one evidence file and line from this directory, as <file>:<line>.',
    'KEEP_BASE is a valid answer when no evidence supports an edit. Never edit a gate, a ceiling or a hard rule.',
    'Answer in proposal.json: {"candidates":[{"id","lens","target","edit","evidence"}]} or {"answer":"KEEP_BASE","reason"}.',
  ];
  return `${lines.join('\n')}\n`;
}

/** Write the context for a verb; returns the directory. */
export function writeContext(root, verb, k = 2) {
  const dir = contextDir(root, verb);
  fs.mkdirSync(dir, { recursive: true });
  const ev = evidence(root, verb);
  for (const [name, text] of Object.entries(ev)) fs.writeFileSync(path.join(dir, name), text);
  fs.writeFileSync(path.join(dir, 'mission.md'), mission(verb, k));
  return dir;
}

/**
 * Validate a parsed proposal against a context dir. Returns { ok, keepBase, problems }. KEEP_BASE alone is valid;
 * otherwise exactly k `inv` and k `dom` candidates, each with a unique id, a target, an edit, and one evidence citation
 * `<file>:<line>` naming a file inside the context dir and a line that exists in it.
 */
export function checkProposal(proposal, dir, k = 2) {
  const problems = [];
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) return { ok: false, keepBase: false, problems: ['proposal is not a JSON object'] };
  if (proposal.answer !== undefined) {
    if (proposal.answer !== 'KEEP_BASE') problems.push(`answer must be KEEP_BASE or absent, got ${JSON.stringify(proposal.answer)}`);
    if (proposal.candidates !== undefined) problems.push('KEEP_BASE stands alone: drop the candidates, or drop the answer');
    return { ok: !problems.length, keepBase: !problems.length, problems };
  }
  const list = proposal.candidates;
  if (!Array.isArray(list)) return { ok: false, keepBase: false, problems: ['proposal needs "candidates" (or "answer": "KEEP_BASE")'] };
  const ids = new Set();
  const per = { inv: 0, dom: 0 };
  list.forEach((c, i) => {
    const at = `candidate ${i + 1}${c?.id ? ` (${c.id})` : ''}`;
    if (!c || typeof c !== 'object') return problems.push(`${at}: not an object`);
    if (!LENSES.includes(c.lens)) problems.push(`${at}: lens must be inv or dom, got ${JSON.stringify(c.lens)}`);
    else per[c.lens]++;
    if (typeof c.id !== 'string' || !c.id.trim()) problems.push(`${at}: no id`);
    else if (ids.has(c.id)) problems.push(`${at}: duplicate id ${c.id}`);
    else ids.add(c.id);
    for (const f of ['target', 'edit']) if (typeof c[f] !== 'string' || !c[f].trim()) problems.push(`${at}: no ${f}`);
    const cite = typeof c.evidence === 'string' ? /^(.+):(\d+)$/.exec(c.evidence.trim()) : null;
    if (!cite) return problems.push(`${at}: evidence must be one <file>:<line> citation`);
    const file = path.resolve(dir, cite[1]);
    if (path.relative(dir, file).startsWith('..') || path.isAbsolute(path.relative(dir, file))) return problems.push(`${at}: evidence ${cite[1]} is outside the context dir`);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return problems.push(`${at}: evidence file ${cite[1]} does not exist in the context dir`);
    const n = fs.readFileSync(file, 'utf8').replace(/\r?\n$/, '').split(/\r?\n/).length;
    if (Number(cite[2]) < 1 || Number(cite[2]) > n) problems.push(`${at}: evidence line ${cite[2]} is outside ${cite[1]} (${n} lines)`);
  });
  for (const lens of LENSES) if (per[lens] !== k) problems.push(`needs exactly ${k} ${lens} candidates, got ${per[lens]}`);
  return { ok: !problems.length, keepBase: false, problems };
}

export function main(argv = process.argv.slice(2), { root, log = console.log, err = console.error } = {}) {
  const flag = (name) => { const at = argv.indexOf(name); return at >= 0 ? argv[at + 1] : undefined; };
  const valued = new Set(['--k', '--root', '--check']);
  const verb = argv.find((a, i) => !a.startsWith('--') && !valued.has(argv[i - 1]));
  const base = flag('--root') ? path.resolve(flag('--root')) : root ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const k = flag('--k') === undefined ? 2 : Number(flag('--k'));
  if (!verb || !Number.isInteger(k) || k < 1) { err('usage: node scripts/refine.mjs <verb> [--k 2] [--dry] [--check <proposal.json>] [--root <dir>]'); return 2; }
  const r = resolveDial(read(path.join(base, 'plan', 'bearings.md')), {});
  if (r.dial !== 'bold') { log(`refine: skipped, Improve is ${r.dial}${r.set ? '' : ' (absent)'} and /refine runs only under bold`); return 0; }
  if (!skillPath(base, verb)) { err(`refine: ${verb} is not a skill to refine (skills/${verb}.md must exist; /refine does not refine itself)`); return 2; }
  const dir = contextDir(base, verb);
  const check = flag('--check');
  if (check !== undefined) {
    let proposal;
    try { proposal = JSON.parse(read(path.resolve(check))); } catch (e) { err(`refine: ${check} is not valid JSON (${e.message})`); return 1; }
    const v = checkProposal(proposal, dir, k);
    if (v.ok) { log(v.keepBase ? 'refine: KEEP_BASE accepted' : `refine: proposal valid (${k} inv, ${k} dom)`); return 0; }
    for (const p of v.problems) err(`refine: ${p}`);
    return 1;
  }
  if (argv.includes('--dry')) { log(`refine: would write ${FILES.map((f) => path.join(path.relative(base, dir), f)).join(', ')}`); return 0; }
  log(`refine: context written to ${path.relative(base, writeContext(base, verb, k)).replace(/\\/g, '/')}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main();
