// `nexus upgrade` on a v2 repo: the sync to the latest kit (spec 58, "v2 to latest: the sync").
//
// The lock's `ref:` names the kit commit the repo follows, so every kit file has three versions: the kit at `ref:`
// (base), the kit this CLI carries (theirs), the repo's copy (ours). Untouched files (ours equals base) are replaced;
// customised ones are three-way merged with `git merge-file`; a conflict goes to an assisted merge (a helper-model
// session given base, theirs and ours that returns a merged file and a one-line reason per hunk it kept from ours),
// shown as a diff marked `assisted` and kept only when the repo's gate is green with it, else the file stays ours and is
// listed. New kit content (a path the kit did not hold at `ref:`) is listed and added; a knob the kit did not name at
// `ref:` arrives at its conservative value (upgrade.mjs KNOBS). Lanes files and custom skills are never touched. The
// lock's `ref:` and `version:` move to the kit commit this CLI was built from; with --write all of it is one commit,
// `plan: sync to nexus <version>`, on `nexus/upgrade-<version>`. Base and theirs both get the kit's placeholders filled
// the repo's way first, so a filled-in placeholder is not a customisation.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cloneUrl } from '../shared/kit.mjs';
import { KNOBS, gate, gitIn, lockField, projectName, writeKnobs } from './upgrade.mjs';
import { MARCH_YML, fill, packageManager } from './workflow-merge.mjs';

export const syncSubject = (version) => `plan: sync to nexus ${version}`;
export const syncBranch = (version) => `nexus/upgrade-${version}`;
/** The kit's march workflow: a seed the v1 path merges, and a kit file the sync merges like any other. */
export const WORKFLOW_FILE = Object.freeze({ kit: `templates/${MARCH_YML}`, repo: MARCH_YML, kind: 'workflow' });

const lf = (t) => String(t ?? '').replace(/\r\n/g, '\n');
const exists = (dir, rel) => fs.existsSync(path.join(dir, ...rel.split('/')));
const read = (dir, rel) => { try { return fs.readFileSync(path.join(dir, ...rel.split('/')), 'utf8'); } catch { return null; } };
function write(dir, rel, text) {
  const abs = path.join(dir, ...rel.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}
const MARKERS = /^(<{7}|={7}|>{7}|\|{7})( |$)/m;

/**
 * The kit commit a nexus checkout carries: { version, ref }. `version` is templates/plan/nexus.lock's, with
 * `+<short sha>` unless HEAD is that version's tag; `ref` is HEAD's full sha. Null outside a git checkout.
 */
export function kitIdentity(nexus) {
  const head = gitIn(nexus, ['rev-parse', 'HEAD']);
  if (!head.ok || !/^[0-9a-f]{40}$/.test(head.out)) return null;
  const version = lockField(read(nexus, 'templates/plan/nexus.lock'), 'version') || '2.0.0';
  const tag = gitIn(nexus, ['describe', '--tags', '--exact-match', '--match', `v${version}`, 'HEAD']);
  return { version: tag.ok ? version : `${version}+${head.out.slice(0, 7)}`, ref: head.out };
}

/** Which kit commit `kit` is: its own `id`, the bundle's files.json `kit`, else the nexus checkout around templates/. */
export function identityOf(kit) {
  if (kit.id) return kit.id;
  if (kit.from === 'bundled') {
    try { return JSON.parse(fs.readFileSync(path.join(kit.root, 'files.json'), 'utf8')).kit || null; } catch { return null; }
  }
  return kitIdentity(path.resolve(kit.root, '..'));
}

/**
 * The kit at `ref` (base): { commit, read(kitPath) -> text | null, close() }, or { error }. A kit in a nexus checkout
 * (or `kit.git`) reads its own history; a bundled kit fetches that one commit of the kit repo (`url`, kit.json's) into a
 * temporary folder, removed by close().
 */
export function openBase(kit, ref, { url = cloneUrl() } = {}) {
  let dir = kit.git || (kit.from === 'templates' ? path.resolve(kit.root, '..') : null);
  let temp = null;
  let want = ref;
  if (!dir) {
    if (!url) return { error: `no kit repo to read ${ref} from (kit.json names none)` };
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-sync-base-'));
    gitIn(temp, ['init', '-q']);
    const got = gitIn(temp, ['fetch', '--quiet', '--depth', '1', url, ref]);
    if (!got.ok) { fs.rmSync(temp, { recursive: true, force: true }); return { error: `could not fetch the kit at ${ref} from ${url}: ${got.err}` }; }
    dir = temp;
    want = 'FETCH_HEAD';
  }
  const commit = gitIn(dir, ['rev-parse', '--verify', '--quiet', `${want}^{commit}`]);
  if (!commit.ok) { if (temp) fs.rmSync(temp, { recursive: true, force: true }); return { error: `the kit commit ${ref} is not in ${dir}` }; }
  return {
    commit: commit.out,
    read: (rel) => {
      const r = spawnSync('git', ['cat-file', 'blob', `${commit.out}:${rel}`], { cwd: dir, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
      return r.status === 0 ? r.stdout : null;
    },
    close: () => { if (temp) fs.rmSync(temp, { recursive: true, force: true }); },
  };
}

function withTemp(fn) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-sync-merge-'));
  try { return fn(d); } finally { fs.rmSync(d, { recursive: true, force: true }); }
}

/** A three-way merge (`git merge-file --diff3`): { text, conflicts }. Throws when git cannot run it. */
export function mergeThree({ base, ours, theirs }) {
  return withTemp((d) => {
    for (const [n, t] of [['ours', ours], ['base', base], ['theirs', theirs]]) fs.writeFileSync(path.join(d, n), lf(t));
    const r = spawnSync('git', ['merge-file', '-p', '--diff3', '-L', 'ours', '-L', 'base', '-L', 'theirs', 'ours', 'base', 'theirs'], { cwd: d, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    if (r.error || r.status == null || r.status > 127) throw new Error(`git merge-file failed: ${(r.stderr || r.error?.message || '').trim()}`);
    return { text: r.stdout, conflicts: r.status };
  });
}

/** A unified diff of `rel` from `a` (the repo's copy) to `b` (`label`: what the sync would write). Empty when equal. */
export function unifiedDiff(a, b, rel, label = 'sync') {
  return withTemp((d) => {
    fs.writeFileSync(path.join(d, 'a'), lf(a));
    fs.writeFileSync(path.join(d, 'b'), lf(b));
    const r = spawnSync('git', ['diff', '--no-index', '--no-color', '-U3', 'a', 'b'], { cwd: d, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    const lines = (r.stdout || '').split('\n');
    const at = lines.findIndex((l) => l.startsWith('--- '));
    if (at === -1) return '';
    return [`--- ours/${rel}`, `+++ ${label}/${rel}`, ...lines.slice(at + 2)].join('\n').replace(/\n+$/, '');
  });
}

/** Does the kit text at `ref:` name this knob? A knob it never named is new since, and arrives conservative. */
function named(text, k) {
  const esc = k.knob.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (k.at === 'var' || k.at === 'section') return new RegExp(`\\b${esc}\\b`).test(text);
  return new RegExp(`(^|[^\\w])${esc}\\**\`?:`, 'm').test(text);
}
/** The written knobs (KNOBS) the base kit text never named: new since `ref:`. */
export const newKnobs = (baseText, registry = KNOBS) => registry.filter((k) => k.write && !named(baseText, k));

/**
 * The assisted merge's helper-model session, through `nexus run`'s seam (headless.mjs runOnce; `query` injectable):
 * an async ({ path, base, ours, theirs, marked }) => { text, reasons } | null. Null when the model is unreachable or its
 * answer is not a merged file.
 */
export function modelAssist({ query, runOnce } = {}) {
  return async ({ path: rel, base, ours, theirs }) => {
    const run = runOnce || (await import('./headless.mjs')).runOnce;
    const prompt = [
      `Three-way merge of ${rel}. BASE is the kit's file the repo started from, THEIRS the kit's latest, OURS the repo's`,
      'customised copy. Return one merged file that takes the kit\'s changes and keeps the repo\'s customisations.',
      'Answer with JSON only: {"merged": "<the whole file>", "reasons": ["<one line per hunk you kept from OURS: what and why>"]}.',
      '', '=== BASE ===', lf(base), '=== THEIRS ===', lf(theirs), '=== OURS ===', lf(ours),
    ].join('\n');
    const r = await run({ prompt, cwd: os.tmpdir(), permissionMode: 'plan', query });
    if (!r || r.is_error || typeof r.result !== 'string') return null;
    const s = r.result;
    try {
      const j = JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1));
      return typeof j.merged === 'string' ? { text: j.merged, reasons: Array.isArray(j.reasons) ? j.reasons.map(String) : [] } : null;
    } catch { return null; }
  };
}

/** The lock with `ref:` and `version:` at the kit commit (each line added when missing). */
export function movedLock(text, { version, ref }) {
  let t = lf(text);
  for (const [k, v] of [['version', version], ['ref', ref]]) {
    const re = new RegExp(`^${k}:.*$`, 'm');
    t = re.test(t) ? t.replace(re, `${k}: ${v}`) : `${t.replace(/\n*$/, '\n')}${k}: ${v}\n`;
  }
  return t;
}

/**
 * The sync in `dir` (a temporary worktree of the repo's origin): { code, report }. `base` (tests) stands in for
 * openBase; `assist` is the assisted merge (null: a conflict stays ours, its diff listed); `gateOf` the repo's gate
 * (upgrade.mjs gate). With `write`, a green result is committed on the sync branch. Report fields beside the
 * upgrade's: sync { from, to, base }, added (new kit content), merges [{ path, kind, diff, reasons?, applied }], commit.
 */
export async function syncRepo({ dir, kit, base = null, write: commitIt = false, assist = null, today, gateOf = gate, branch = 'main' } = {}) {
  const report = { sync: null, files: [], added: [], merges: [], knobs: [], warnings: [], gate: [], commit: null };
  const lockText = read(dir, 'plan/nexus.lock');
  const from = lockField(lockText, 'ref');
  if (!from) return { code: 0, report: { ...report, message: 'already on v2', why: 'plan/nexus.lock names no ref:, so there is no kit commit to merge from (add the ref it adopted, e.g. ref: v2.0.0)' } };
  const to = identityOf(kit);
  if (!to) return { code: 2, report: { ...report, error: 'this CLI cannot tell which kit commit it carries (no kit identity in the bundle)' } };
  const b = base || openBase(kit, from);
  if (b.error) return { code: 2, report: { ...report, error: b.error } };
  try {
    report.sync = { from, to, base: b.commit };
    if (from === to.ref || b.commit === to.ref) return { code: 0, report: { ...report, message: 'already on the latest kit', why: `plan/nexus.lock ref: ${from} is the kit this CLI carries (nexus ${to.version})` } };
    const fills = { project: projectName(dir), pm: packageManager((f) => exists(dir, f)), branch };
    const files = [...kit.files];
    if (!files.some((f) => f.repo === WORKFLOW_FILE.repo) && exists(kit.root, MARCH_YML)) files.push(WORKFLOW_FILE);
    const kitText = (f) => read(kit.root, f.kit.replace(/^templates\//, ''));
    const touched = new Set();
    const put = (rel, text) => { write(dir, rel, text); touched.add(rel); };
    const conflicts = [];
    let baseText = '';
    for (const f of files) {
      const raw = kitText(f);
      if (raw == null) continue;
      const theirs = fill(lf(raw), fills);
      const ours = read(dir, f.repo);
      const was = b.read(f.kit);
      if (was != null) baseText += `\n${was}`;
      if (f.kind === 'lane') {
        if (ours != null) report.files.push({ path: f.repo, status: 'kept-custom', note: 'a lanes file: the sync never touches it' });
        else { put(f.repo, theirs); report.files.push({ path: f.repo, status: 'seeded' }); }
        continue;
      }
      const old = was == null ? null : fill(lf(was), fills);
      if (ours == null) {
        put(f.repo, theirs);
        report.files.push({ path: f.repo, status: 'added', ...(old == null ? { note: 'new kit content' } : { note: 'missing from the repo' }) });
        if (old == null) report.added.push({ path: f.repo, kind: f.kind });
        continue;
      }
      const mine = lf(ours);
      if (mine === theirs) continue;
      if (old == null) {
        report.files.push({ path: f.repo, status: 'kept-custom', note: 'the kit now ships this path; the repo\'s own file is kept' });
        report.warnings.push(`${f.repo}: the kit now ships a file at this path; the repo's own is kept (compare them by hand)`);
        continue;
      }
      if (mine === old) { put(f.repo, theirs); report.files.push({ path: f.repo, status: 'replaced' }); continue; }
      if (old === theirs) { report.files.push({ path: f.repo, status: 'kept-custom', note: 'customised; the kit has not changed it since ref:' }); continue; }
      const m = mergeThree({ base: old, ours: mine, theirs });
      if (!m.conflicts) {
        put(f.repo, m.text);
        report.files.push({ path: f.repo, status: 'merged', note: 'customised: three-way merged, clean' });
        report.merges.push({ path: f.repo, kind: 'merged', diff: unifiedDiff(mine, m.text, f.repo, 'merged'), applied: true });
      } else conflicts.push({ f, base: old, ours: mine, theirs, marked: m.text, n: m.conflicts });
    }

    // Knobs the kit did not name at ref: arrive at their conservative values; the repo's own lines are kept.
    const fresh = newKnobs(baseText);
    if (fresh.length) {
      const bearings = read(dir, 'plan/bearings.md');
      const kn = writeKnobs(bearings, { today, registry: fresh, why: 'keep this loop\'s\nbehaviour (each is new in the kit since the last sync)' });
      report.knobs = kn.knobs;
      const wrote = kn.knobs.filter((k) => k.at !== 'var' && k.status === 'written');
      if (wrote.length) {
        put('plan/bearings.md', kn.text);
        report.files.push({ path: 'plan/bearings.md', status: bearings == null ? 'added' : 'knobs written', note: wrote.map((k) => (k.at === 'section' ? `## ${k.knob} ${k.value}` : `${k.knob}: ${k.value}`)).join(', ') });
      }
    }

    put('plan/nexus.lock', movedLock(lockText, to));
    report.files.push({ path: 'plan/nexus.lock', status: 'replaced', note: `ref: ${from} -> ${to.ref.slice(0, 12)}, version: ${to.version}` });

    // The gate on everything but the assisted merges first: red here is the sync's own fault, nothing is committed.
    report.gate = gateOf(dir);
    if (report.gate.some((g) => !g.ok)) return { code: 1, report: finish(report) };

    // Each conflict to the assisted merge; its result stays only if the repo's gate is green with it.
    const tried = [];
    for (const c of conflicts) {
      let r = null;
      if (assist) { try { r = await assist({ path: c.f.repo, base: c.base, ours: c.ours, theirs: c.theirs, marked: c.marked }); } catch (e) { report.warnings.push(`${c.f.repo}: the assisted merge failed: ${e.message}`); } }
      if (r && typeof r.text === 'string' && !MARKERS.test(r.text)) {
        const text = r.text.endsWith('\n') ? r.text : `${r.text}\n`;
        tried.push({ c, text, reasons: r.reasons || [] });
        write(dir, c.f.repo, text);
      } else {
        report.files.push({ path: c.f.repo, status: 'conflict (left as ours)', note: `${c.n} conflicting hunk${c.n === 1 ? '' : 's'}${assist ? '; the assisted merge returned no clean file' : '; no assisted merge (--no-assist)'}` });
        report.merges.push({ path: c.f.repo, kind: 'conflict', diff: unifiedDiff(c.ours, c.marked, c.f.repo, 'conflict'), applied: false });
      }
    }
    if (tried.length) {
      const g = gateOf(dir);
      const green = g.every((x) => x.ok);
      report.gate = green ? g : report.gate;
      for (const t of tried) {
        if (green) touched.add(t.c.f.repo);
        else write(dir, t.c.f.repo, t.c.ours);
        report.files.push({ path: t.c.f.repo, status: green ? 'assisted' : 'assisted (left as ours)', note: green ? 'conflict resolved by the assisted merge; the gate is green with it' : 'the gate went red with the assisted merge, so the file stays as ours' });
        report.merges.push({ path: t.c.f.repo, kind: 'assisted', diff: unifiedDiff(t.c.ours, t.text, t.c.f.repo, 'assisted'), reasons: t.reasons, applied: green });
      }
      if (!green) report.warnings.push(`the gate went red with the assisted merge of ${tried.map((t) => t.c.f.repo).join(', ')}: left as ours (${g.filter((x) => !x.ok).map((x) => x.name).join(', ')})`);
    }
    for (const m of report.merges.filter((x) => !x.applied)) report.warnings.push(`${m.path}: left as ours; merge the kit's change by hand (the ${m.kind} diff is in the report)`);

    if (commitIt) {
      const name = syncBranch(to.version);
      const sw = gitIn(dir, ['switch', '-q', '-C', name]);
      const add = sw.ok && gitIn(dir, ['add', '--', ...[...touched].sort()]);
      const counts = ['replaced', 'merged', 'assisted', 'added'].map((s) => [s, report.files.filter((f) => f.status === s).length]).filter(([, n]) => n);
      const body = `${counts.map(([s, n]) => `${n} ${s}`).join(', ') || 'the lock only'}; ref: ${from} -> ${to.ref}`;
      const done = add && add.ok && gitIn(dir, ['commit', '-q', '-m', syncSubject(to.version), '-m', body]);
      if (!done || !done.ok) {
        report.error = `the sync commit failed: ${(done || add || sw).err || 'git refused'}`;
        return { code: 1, report: finish(report) };
      }
      report.commit = { sha: gitIn(dir, ['rev-parse', 'HEAD']).out, branch: name, subject: syncSubject(to.version) };
    }
    return { code: 0, report: finish(report) };
  } finally {
    if (!base) b.close();
  }
}

function finish(report) {
  const by = new Map();
  for (const r of report.files) by.set(r.path, r);
  report.files = [...by.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return report;
}

/** The sync's report as the terminal reads it. */
export function renderSync(report, { color = false } = {}) {
  const red = (s) => (color ? `\u001b[31m${s}\u001b[0m` : s);
  const out = [];
  const s = report.sync;
  out.push(report.commit ? 'nexus upgrade: sync to the latest kit (committed on a branch; the local checkout is not touched)' : 'nexus upgrade: sync to the latest kit, dry run (nothing written; the local checkout is not touched)');
  out.push(`  repo     ${report.repo}`);
  if (report.origin) out.push(`  origin   ${report.origin.url} ${report.origin.branch} @ ${report.origin.sha.slice(0, 7)} (fetched now)`);
  if (s) out.push(`  kit      ${s.from} -> nexus ${s.to.version} (${s.to.ref.slice(0, 12)})`);
  if (report.message) { out.push('', `${report.message}: ${report.why}. Nothing to sync.`); return out.join('\n'); }
  if (report.error && !report.files.length) { out.push('', `nexus upgrade: ${report.error}`); return out.join('\n'); }
  out.push('', `files (${report.files.length})`);
  const w = Math.max(8, ...report.files.map((f) => f.status.length));
  for (const f of report.files) out.push(`  ${f.status.padEnd(w)}  ${f.path}${f.note ? `  (${f.note})` : ''}`);
  out.push('', `new kit content (${report.added.length})`);
  for (const a of report.added) out.push(`  + ${a.path}  (${a.kind})`);
  for (const m of report.merges) {
    out.push('', `${m.kind === 'assisted' ? 'assisted' : m.kind === 'conflict' ? red('conflict') : 'merged'}  ${m.path}${m.applied ? '' : '  (left as ours)'}`);
    for (const r of m.reasons || []) out.push(`  kept from ours: ${r}`);
    if (m.diff) for (const l of m.diff.split('\n')) out.push(`  ${l}`);
  }
  if (report.knobs.length) {
    const written = report.knobs.filter((k) => k.at !== 'var' && k.status === 'written');
    const set = report.knobs.filter((k) => k.status === 'set');
    const unset = report.knobs.filter((k) => k.status === 'unset');
    out.push('', 'new knobs (conservative: behaviour does not change until you turn each up)');
    if (written.length) out.push(`  plan/bearings.md  ${written.map((k) => `${k.at === 'section' ? `## ${k.knob}` : k.knob} ${k.value}`).join(', ')}`);
    if (unset.length) out.push(`  leave unset      ${unset.map((k) => k.knob).join(', ')}`);
    for (const k of set) out.push(`  ${k.line}`);
  }
  out.push('', `warnings (${report.warnings.length})`);
  for (const wn of report.warnings) out.push(`  - ${wn}`);
  out.push('', 'gate');
  for (const g of report.gate) {
    out.push(`  ${g.ok ? 'green' : red('RED  ')}  ${g.name}`);
    if (!g.ok && g.out) for (const l of g.out.split('\n')) out.push(`         ${l}`);
  }
  if (report.error) out.push('', `nexus upgrade: ${report.error}`);
  out.push('');
  if (report.commit) out.push(`committed ${report.commit.sha.slice(0, 7)} ${report.commit.subject} on ${report.commit.branch}: push it and open a pull request, or merge it`);
  else if (report.worktree) out.push(`worktree kept: ${report.worktree}`);
  else out.push('The worktree is removed. --write commits this as one commit on its own branch.');
  return out.join('\n');
}
