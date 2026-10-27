#!/usr/bin/env node
// scripts/pr/acceptance.mjs: the logic of the `judge` check (spec 61). A pull request's body proves each acceptance
// ID it closes, one line apiece under `## Acceptance`:
//
//   - A3 · test/claims.test.mjs            a proof file: it must exist and pass (node --test <file>)
//   - A4 · npm run lint                    a proof command: it must exit 0 (`node --test <file>` names a file too)
//   - A5 · (no test: prose only)           a stated reason; the line is the proof
//
// and a test the PR adds that already passes on the merge base proves nothing about the change, so it fails
// unless the body carries `guard-test: <path> <reason>` for it (a regression guard that is meant to pass).
//
// Everything that touches the world (files, the test runner, git) comes in through `io`, so the suites run on
// fixtures. `gitIo` is the real one: git and node, run on the PR head with no token in reach (the judge job's
// job; this file reads no environment).
//
//   node scripts/pr/acceptance.mjs <body-file> [--closed A1,A2] [--base <sha>] [--root <dir>] [--json]
//
// Closed IDs are the union of: --closed, `closes A1, A2` in the body, and (with --base) every `- **A<n>**` line
// the PR removes from plan/. Exit 0 when every closed ID is proven, 1 otherwise, 2 on a bad call.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const TEST_FILE = /(\.test\.[cm]?[jt]sx?|\.spec\.[cm]?[jt]sx?)$|(^|\/)(__tests__|tests?)\//;
const NODE_TEST = /^node\s+--test\s+(.+)$/;

const unquote = (s) => s.trim().replace(/^`+|`+$/g, '').trim();

/** The body's `## Acceptance` section as proof lines: [{ id, proof, kind: 'files'|'command'|'no-test', files, reason }].
 * `guard-test:` lines anywhere in the text are read by `parseGuards`. A malformed line is skipped (the ID then has
 * no line, and fails as one). */
export function parseAcceptance(text) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let inside = false;
  for (const line of lines) {
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
  if (nt) return { id, proof, kind: 'command', files: nt[1].split(/\s+/).filter((f) => !f.startsWith('-')), reason: '' };
  if (!/\s/.test(proof.replace(/,\s+/g, ','))) return { id, proof, kind: 'files', files: proof.split(',').map(unquote).filter(Boolean), reason: '' };
  return { id, proof, kind: 'command', files: [], reason: '' };
}

/** `guard-test: <path> <reason>` lines: Map path -> reason. A guard with no reason is dropped (it names nothing a
 * reviewer can weigh), so the test it names still fails the replay. */
export function parseGuards(text) {
  const guards = new Map();
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:[-*]\s+)?guard-test\s*:\s*(\S+)\s*(.*?)\s*$/i);
    if (!m) continue;
    const reason = m[2].replace(/^[·:\-—–]\s*/, '').trim();
    if (reason) guards.set(unquote(m[1]), reason);
  }
  return guards;
}

/** A-IDs the body says it closes: `closes A1, A2` (any case, `and` allowed). */
export function closedFromBody(text) {
  const ids = new Set();
  for (const m of String(text ?? '').matchAll(/\bcloses?\s+((?:A\d+(?:\s*(?:,|and|&)\s*)?)+)/gi)) {
    for (const id of m[1].matchAll(/A\d+/gi)) ids.add(id[0].toUpperCase());
  }
  return [...ids];
}

/** A-IDs a unified diff removes from a spec: the `- **A3** ...` lines that start with `-` in the patch. */
export function closedFromDiff(diff) {
  const ids = new Set();
  for (const m of String(diff ?? '').matchAll(/^-\s?- \*\*(A\d+)\*\*/gm)) ids.add(m[1]);
  return [...ids];
}

/** The proof files a test-file path list holds, per this repo's test naming. */
export const isTestFile = (p) => TEST_FILE.test(p.replace(/\\/g, '/'));

/**
 * Judge a body. `io` is { exists(path) -> bool, run(proof: {kind, files, proof}) -> { ok, detail? },
 * added() -> string[] (paths the PR adds), passesOnBase(path) -> bool }. Returns { ok, rows, replay, failures }:
 * one row per closed ID ({ id, proof, status, detail }), one replay entry per added test ({ path, status }).
 */
export function judge({ body, closed = [], io }) {
  const ids = [...new Set([...closed, ...closedFromBody(body)])].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  const lines = parseAcceptance(body);
  const rows = [];
  const failures = [];
  for (const id of ids) {
    const line = lines.find((l) => l.id === id);
    if (!line) {
      rows.push({ id, proof: '', status: 'no-line', detail: 'closed with no proof line' });
      failures.push(`${id}: closed with no proof line under ## Acceptance (\`- ${id} · <test file>\` or \`- ${id} · (no test: <reason>)\`)`);
      continue;
    }
    if (line.kind === 'no-test') {
      const ok = line.reason.length > 0;
      rows.push({ id, proof: line.proof, status: ok ? 'no-test' : 'no-reason', detail: line.reason });
      if (!ok) failures.push(`${id}: \`(no test: )\` gives no reason`);
      continue;
    }
    const gone = line.files.filter((f) => !io.exists(f));
    if (gone.length) {
      rows.push({ id, proof: line.proof, status: 'missing', detail: `missing: ${gone.join(', ')}` });
      failures.push(`${id}: proof file missing: ${gone.join(', ')}`);
      continue;
    }
    const res = io.run(line);
    rows.push({ id, proof: line.proof, status: res.ok ? 'pass' : 'red', detail: res.detail ?? '' });
    if (!res.ok) failures.push(`${id}: proof is red: ${line.proof}`);
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

const sh = (cmd, args, opts) => spawnSync(cmd, args, { encoding: 'utf-8', ...opts });

/** The real `io`: files under `root`, node's test runner, git for the merge base. Nothing here reads a secret. */
export function gitIo({ root = process.cwd(), base = null } = {}) {
  const git = (...args) => sh('git', args, { cwd: root });
  return {
    exists: (p) => fs.existsSync(path.join(root, p)),
    run: (line) => {
      const r = line.kind === 'files'
        ? sh(process.execPath, ['--test', ...line.files], { cwd: root })
        : sh(line.proof, [], { cwd: root, shell: true });
      return { ok: r.status === 0, detail: r.status === 0 ? '' : `exit ${r.status}` };
    },
    added: () => {
      if (!base) return [];
      const r = git('diff', '--name-only', '--diff-filter=A', `${base}...HEAD`);
      return r.status === 0 ? r.stdout.split('\n').map((s) => s.trim()).filter(Boolean) : [];
    },
    // The parent replay: the base's tree with the PR's test file dropped in, run there. Pass = exit 0.
    passesOnBase: (file) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-replay-'));
      try {
        if (git('worktree', 'add', '--detach', dir, base).status !== 0) return false;
        const dest = path.join(dir, file);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(path.join(root, file), dest);
        return sh(process.execPath, ['--test', file], { cwd: dir }).status === 0;
      } finally {
        git('worktree', 'remove', '--force', dir);
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    specDiff: () => (base ? git('diff', `${base}...HEAD`, '--', 'plan/').stdout ?? '' : ''),
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
  const io = gitIo({ root: opt('--root') ?? process.cwd(), base: opt('--base') });
  const closed = [...(opt('--closed') ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean), ...closedFromDiff(io.specDiff())];
  const result = judge({ body: fs.readFileSync(file, 'utf-8'), closed, io });
  if (args.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(summary(result));
    for (const f of result.failures) console.error(`judge: ${f}`);
  }
  return result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv));
