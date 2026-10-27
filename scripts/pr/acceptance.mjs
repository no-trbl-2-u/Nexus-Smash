#!/usr/bin/env node
// scripts/pr/acceptance.mjs: the logic of the `judge` check (spec 61). A pull request's body proves each acceptance
// ID it closes, one line apiece under `## Acceptance`:
//
//   - A3 · test/claims.test.mjs            a proof file: it must exist, be added or changed by the PR, and pass
//   - A4 · node --test a.test.mjs b.test.mjs   the same, spelled as the runner's own command
//   - A5 · (no test: prose only)           a stated reason; the line is the proof
//
// A proof is only ever `node --test <paths>`, run without a shell, from the checkout root, with paths that stay
// inside it and an environment of PATH, HOME and the temp dirs alone (no token reaches a PR's code). Any other
// command is refused: the body is written by the PR's author, so a command line there is the author's shell.
// (The spec's Contracts allow `<command>`; they stay disabled until a sandbox for them is decided.) A run counts
// only if it reports at least one passing test: an empty file proves nothing.
//
// A test the PR adds that already passes on the merge base proves nothing about the change, so it fails unless
// the body carries `guard-test: <path> <reason>` for it (a regression guard that is meant to pass). Only files
// named *.test.* or *.spec.* are tests; helpers and fixtures are not.
//
// Everything that touches the world (files, the test runner, git) comes in through `io`, so the suites run on
// fixtures. `gitIo` is the real one: git and node, run on the PR head.
//
//   node scripts/pr/acceptance.mjs <body-file> [--closed A1,A2] [--base <sha>] [--root <dir>] [--json]
//
// Closed IDs are the union of: --closed, `closes A1, A2` in the body, and (with --base) every `- **A<n>**` line
// the PR removes from plan/. Exit 0 when every closed ID is proven, 1 otherwise, 2 when the call or the --base is
// unusable (a bogus sha, unrelated history, a shallow clone): the judge fails closed, never open.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const HELPER_DIR = /(^|\/)(__tests__|tests?|fixtures?)\//;
const NODE_TEST = /^node\s+--test\s+(.+)$/;

const unquote = (s) => s.trim().replace(/^`+|`+$/g, '').trim();

/** The text with HTML comments and fenced code blocks blanked out, so neither can carry a proof or a `closes`. */
export function stripNoise(text) {
  const t = String(text ?? '').replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?(-->|$)/g, '');
  const out = [];
  let fence = null;
  for (const line of t.split('\n')) {
    const m = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
      continue;
    }
    if (m) { fence = m[1]; continue; }
    out.push(line);
  }
  return out.join('\n');
}

/** The body's `## Acceptance` section as proof lines: [{ id, proof, kind: 'files'|'command'|'no-test', files, reason }].
 * A malformed line is skipped (the ID then has no line, and fails as one). */
export function parseAcceptance(text) {
  const out = [];
  let inside = false;
  for (const line of stripNoise(text).split('\n')) {
    if (/^#{1,6}\s/.test(line)) inside = /^#{2,6}\s+acceptance\s*$/i.test(line.trim());
    else if (inside) {
      const m = line.match(/^\s*[-*]\s+(A\d+)\s+·\s+(.+?)\s*$/);
      if (m) out.push(proofLine(m[1], m[2]));
    }
  }
  return out;
}

function proofLine(id, raw) {
  const no = raw.match(/^\(\s*no test\s*:\s*(.*?)\s*\)$/i);
  if (no) return { id, proof: raw, kind: 'no-test', files: [], reason: no[1] };
  const proof = unquote(raw);
  const nt = proof.match(NODE_TEST);
  if (nt) return { id, proof, kind: 'files', files: nt[1].split(/\s+/).filter(Boolean), reason: '' };
  if (!/\s/.test(proof.replace(/,\s+/g, ','))) return { id, proof, kind: 'files', files: proof.split(',').map(unquote).filter(Boolean), reason: '' };
  return { id, proof, kind: 'command', files: [], reason: '' };
}

/** Whether a proof path may run: relative, inside the checkout, not an option. */
export function unsafePath(p) {
  const s = String(p).replace(/\\/g, '/');
  if (!s || s.startsWith('-') || s.startsWith('/') || /^[A-Za-z]:/.test(s) || s.includes('\0')) return true;
  const n = path.posix.normalize(s);
  return n === '..' || n.startsWith('../');
}

/** `guard-test: <path> <reason>` lines: Map path -> reason. A guard with no reason is dropped (it names nothing a
 * reviewer can weigh), so the test it names still fails the replay. */
export function parseGuards(text) {
  const guards = new Map();
  for (const line of stripNoise(text).split('\n')) {
    const m = line.match(/^\s*(?:[-*]\s+)?guard-test\s*:\s*(\S+)\s*(.*?)\s*$/i);
    if (!m) continue;
    const reason = m[2].replace(/^[·:\-—–]\s*/, '').trim();
    if (reason) guards.set(unquote(m[1]), reason);
  }
  return guards;
}

/** A-IDs the body says it closes: `closes A1, A2` or `Closes: A1` (any case, `and` allowed); a negation
 * ("does not close A1") closes nothing. */
export function closedFromBody(text) {
  const ids = new Set();
  const re = /(?<!\b(?:not|never|no|n't)\s)(?<!n't\s)\bcloses?\s*:?\s+((?:A\d+(?:\s*(?:,|and|&)\s*)?)+)/gi;
  for (const m of stripNoise(text).matchAll(re)) {
    for (const id of m[1].matchAll(/A\d+/gi)) ids.add(id[0].toUpperCase());
  }
  return [...ids];
}

/** A-IDs a unified diff removes from a spec: a removed `- **A3** ...` list item, which the patch shows as `-- **A3**`. */
export function closedFromDiff(diff) {
  const ids = new Set();
  for (const m of String(diff ?? '').matchAll(/^-- \*\*(A\d+)\*\*/gm)) ids.add(m[1]);
  return [...ids];
}

/** Whether a path is a test by its name (`*.test.*`, `*.spec.*`). Helpers and fixtures under test/ are not. */
export const isTestFile = (p) => TEST_FILE.test(p.replace(/\\/g, '/'));

/**
 * Judge a body. `io` is { exists(path) -> bool, run({ files }) -> { ok, detail? }, added() -> string[] (paths the PR
 * adds), changed?() -> Set|null (paths the PR adds or modifies; null = unknown), passesOnBase(path) -> bool }.
 * Returns { ok, rows, replay, failures }: one row per closed ID ({ id, proof, status, detail }), one replay entry
 * per added test ({ path, status }).
 */
export function judge({ body, closed = [], io }) {
  const ids = [...new Set([...closed, ...closedFromBody(body)])].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  const lines = parseAcceptance(body);
  const changed = io.changed ? io.changed() : null;
  const rows = [];
  const failures = [];
  const row = (id, proof, status, detail, failure) => {
    rows.push({ id, proof, status, detail });
    if (failure) failures.push(`${id}: ${failure}`);
  };
  for (const id of ids) {
    const line = lines.find((l) => l.id === id);
    if (!line) {
      row(id, '', 'no-line', 'closed with no proof line', `closed with no proof line under ## Acceptance (\`- ${id} · <test file>\` or \`- ${id} · (no test: <reason>)\`)`);
    } else if (line.kind === 'no-test') {
      const ok = line.reason.length > 0;
      row(id, line.proof, ok ? 'no-test' : 'no-reason', line.reason, ok ? null : '`(no test: )` gives no reason');
    } else if (line.kind === 'command') {
      row(id, line.proof, 'disabled', 'only `node --test <paths>` runs', `proof command not run (only a test file or \`node --test <paths>\` is a proof): ${line.proof}`);
    } else {
      const bad = line.files.filter(unsafePath);
      const gone = line.files.filter((f) => !unsafePath(f) && !io.exists(f));
      const idle = changed ? line.files.filter((f) => !unsafePath(f) && io.exists(f) && !changed.has(f)) : [];
      if (!line.files.length) row(id, line.proof, 'missing', 'names no file', 'proof names no file');
      else if (bad.length) row(id, line.proof, 'unsafe', `not a path inside the checkout: ${bad.join(', ')}`, `proof path must be relative and inside the checkout: ${bad.join(', ')}`);
      else if (gone.length) row(id, line.proof, 'missing', `missing: ${gone.join(', ')}`, `proof file missing: ${gone.join(', ')}`);
      else if (idle.length) row(id, line.proof, 'untouched', `not added or changed by this PR: ${idle.join(', ')}`, `proof file not added or changed by this PR: ${idle.join(', ')}`);
      else {
        const res = io.run(line);
        row(id, line.proof, res.ok ? 'pass' : 'red', res.detail ?? '', res.ok ? null : `proof is red: ${line.proof}`);
      }
    }
  }
  const guards = parseGuards(body);
  const replay = [];
  for (const file of io.added().filter(isTestFile)) {
    if (!io.exists(file)) continue;
    if (!io.passesOnBase(file)) replay.push({ path: file, status: 'fails-on-base' });
    else if (guards.has(file)) replay.push({ path: file, status: 'guarded', detail: guards.get(file) });
    else {
      replay.push({ path: file, status: 'passes-on-base' });
      failures.push(`${file}: passes on the merge base, so it cannot fail for this change (add \`guard-test: ${file} <reason>\` if it is meant to)`);
    }
  }
  return { ok: failures.length === 0, rows, replay, failures };
}

/** The step-summary table, one row per A-ID. */
export function summary({ rows, replay }) {
  const out = ['| A-ID | Proof | Result |', '|---|---|---|'];
  for (const r of rows) out.push(`| ${r.id} | ${r.proof ? `\`${r.proof}\`` : ''} | ${r.status}${r.detail && r.status !== 'pass' ? `: ${r.detail}` : ''} |`);
  if (replay.length) {
    out.push('', '| Added test | Parent replay |', '|---|---|');
    for (const r of replay) out.push(`| \`${r.path}\` | ${r.status}${r.detail ? `: ${r.detail}` : ''} |`);
  }
  return out.join('\n');
}

/** The markdown the judge appends to the step summary: a verdict line, the table (one row per A-ID) and the
 * failures. Returned, not written, so a suite can read it. */
export function stepSummary(result) {
  const out = [`## judge: ${result.ok ? 'pass' : 'fail'}`, '', result.rows.length ? summary(result) : '_No acceptance ID is closed by this PR._'];
  if (result.failures.length) out.push('', ...result.failures.map((f) => `- ${f}`));
  return `${out.join('\n')}\n`;
}

/** Appends the step summary to the file named by GITHUB_STEP_SUMMARY, when that is set. Returns whether it wrote; a
 * file that cannot be written is a warning, never a verdict (the exit code is the check). */
export function writeStepSummary(result, { env = process.env, append = fs.appendFileSync } = {}) {
  const file = env.GITHUB_STEP_SUMMARY;
  if (!file) return false;
  try {
    append(file, `${stepSummary(result)}\n`);
    return true;
  } catch (e) {
    console.error(`judge: step summary not written: ${e.message}`);
    return false;
  }
}

// What a child process sees: PATH, a home, the temp dirs and (on Windows) the system root. Nothing else, so no
// token in the judge's environment reaches a PR's code, and a nested node:test context does not leak in.
const KEEP_ENV = new Set(['PATH', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR']);
export const childEnv = (env = process.env) => Object.fromEntries(Object.entries(env).filter(([k]) => KEEP_ENV.has(k.toUpperCase())));
const sh = (cmd, args, opts) => spawnSync(cmd, args, { encoding: 'utf-8', env: childEnv(), shell: false, ...opts });

/** The passing, non-skipped tests in a TAP report. A file with no tests in it is reported as one passing "test"
 * named after the file; that entry, suites, skips and todos do not count. */
export function countPassed(tap, files = []) {
  const names = new Set(files.flatMap((f) => [f.replace(/\\+/g, '/'), path.basename(f)]));
  let n = 0;
  for (const chunk of tap.split(/^(?=\s*(?:not )?ok \d+ - )/m)) {
    const m = chunk.match(/^\s*ok \d+ - (.*)$/m);
    if (!m || /#\s*(SKIP|TODO)\b/i.test(m[1]) || !/type: 'test'/.test(chunk)) continue;
    if (!names.has(m[1].trim().replace(/\\+/g, '/'))) n++;
  }
  return n;
}

/** Runs `node --test` on files in `cwd`: ok only when it exits 0 and reports at least one passing test. */
function runTests(cwd, files) {
  const r = sh(process.execPath, ['--test', '--test-reporter=tap', ...files], { cwd });
  const passed = countPassed(r.stdout ?? '', files);
  if (r.status !== 0) return { ok: false, detail: `exit ${r.status}` };
  return passed > 0 ? { ok: true, detail: '' } : { ok: false, detail: 'ran no passing test' };
}

/** The real `io`: files under `root`, node's test runner, git for the merge base. With a `base`, throws a clear
 * error when git cannot say what the PR changed (bogus sha, unrelated history, shallow clone), so the judge fails. */
export function gitIo({ root = process.cwd(), base = null } = {}) {
  const git = (...args) => sh('git', args, { cwd: root });
  const must = (r, what) => {
    if (r.status !== 0) throw new Error(`--base ${base} is unusable: ${what} failed (${(r.stderr || '').trim().split('\n')[0] || `exit ${r.status}`}); a shallow clone needs fetch-depth 0`);
    return r.stdout ?? '';
  };
  let mb = null;
  let status = null;
  if (base) {
    must(git('rev-parse', '--verify', '--quiet', `${base}^{commit}`), 'rev-parse');
    mb = must(git('merge-base', base, 'HEAD'), 'merge-base').trim();
    status = must(git('diff', '--name-status', '--no-renames', mb, 'HEAD'), 'diff').split('\n').filter(Boolean).map((l) => {
      const [s, ...rest] = l.split('\t');
      return { s: s[0], p: rest.join('\t') };
    });
  }
  return {
    exists: (p) => !unsafePath(p) && fs.existsSync(path.join(root, p)),
    run: (line) => runTests(root, line.files.filter((f) => !unsafePath(f))),
    added: () => (status ? status.filter((x) => x.s === 'A').map((x) => x.p) : []),
    changed: () => (status ? new Set(status.filter((x) => x.s === 'A' || x.s === 'M').map((x) => x.p)) : null),
    // The parent replay: the merge base's tree plus the helpers and fixtures the PR added under test dirs and the
    // test file itself, run there. Pass = exit 0 with at least one passing test; a test that cannot load fails.
    passesOnBase: (file) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-replay-'));
      try {
        must(git('worktree', 'add', '--detach', dir, mb), 'worktree add');
        const bring = status.filter((x) => x.s === 'A' && (x.p === file || (!isTestFile(x.p) && HELPER_DIR.test(x.p)))).map((x) => x.p);
        for (const p of bring) {
          fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
          fs.copyFileSync(path.join(root, p), path.join(dir, p));
        }
        return runTests(dir, [file]).ok;
      } finally {
        git('worktree', 'remove', '--force', dir);
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    specDiff: () => (mb ? must(git('diff', mb, 'HEAD', '--', 'plan/'), 'diff of plan/') : ''),
  };
}

function main(argv) {
  const args = argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const file = args.find((a, i) => !a.startsWith('--') && !['--closed', '--base', '--root'].includes(args[i - 1]));
  if (!file || !fs.existsSync(file)) {
    console.error('usage: node scripts/pr/acceptance.mjs <body-file> [--closed A1,A2] [--base <sha>] [--root <dir>] [--json]');
    return 2;
  }
  let result;
  try {
    const io = gitIo({ root: opt('--root') ?? process.cwd(), base: opt('--base') });
    const closed = [...(opt('--closed') ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean), ...closedFromDiff(io.specDiff())];
    result = judge({ body: fs.readFileSync(file, 'utf-8'), closed, io });
  } catch (e) {
    console.error(`judge: ${e.message}`);
    return 2;
  }
  writeStepSummary(result);
  if (args.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(summary(result));
    for (const f of result.failures) console.error(`judge: ${f}`);
  }
  return result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv));
