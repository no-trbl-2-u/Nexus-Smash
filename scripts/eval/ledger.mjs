#!/usr/bin/env node
// scripts/eval/ledger.mjs: the escape ledger (spec 61). A measure of how often the merge gate was wrong, taken from
// merged pull requests and nothing else. Per merged PR it counts four escapes:
//
//   early    merged before its checks finished: a check that had started was still running at the merge, or ended
//            after it. A check that started after the merge is a post-merge run (a release job), not a gate.
//   nojudge  merged with no `judge` check run (spec 61.2) among the checks that had started.
//   unproven acceptance lines with no proof: each A-ID the body says it closes (`Closes A3`, `Closes **A3**`) with
//            no proof line under `## Acceptance`, plus each proof line that reads `(no test: ...)`.
//   fixed    a fix landed within 7 days: a later merged PR, inside the window, whose title starts `fix` or `revert`
//            and which names this PR (`#N`, `/pull/N`) or carries a chunk id (`39.11`) that this PR's title carries.
//
// The ledger is regenerated, never edited: `plan/eval/ledger.md` is this script's output. /digest runs it and prints
// the one-line summary. gh comes in through `io.gh`, so the suites run on fixtures.
//
//   node scripts/eval/ledger.mjs [--since YYYY-MM-DD | --last <n>] [--repo owner/name] [--write] [--out <file>]
//
// Without --since the window is the last 10 merged PRs. Last line is the summary; exit 0, or 1 when gh fails.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseAcceptance, stripNoise } from '../pr/acceptance.mjs';

export const OUT = 'plan/eval/ledger.md';
export const FIX_DAYS = 7;
const FIELDS = 'number,title,body,mergedAt,statusCheckRollup';
const CHUNK_ID = /\b\d+\.\d+\b/g;
const DAY = 86400000;

const ms = (iso) => (iso ? Date.parse(iso) : NaN);
const checkName = (c) => String(c?.name ?? c?.context ?? '');

/** The check runs that gated the merge: those that had started by `mergedAt`. A run with no start time counts. */
export function gating(checks, mergedAt) {
  const at = ms(mergedAt);
  return (checks ?? []).filter((c) => !(ms(c.startedAt) > at));
}

/** Whether any gating check was unfinished at the merge: not completed, or completed after it. */
export function mergedEarly(checks, mergedAt) {
  const at = ms(mergedAt);
  return gating(checks, mergedAt).some((c) => String(c.status ?? '').toUpperCase() !== 'COMPLETED' || !(ms(c.completedAt) <= at));
}

/** Whether a `judge` check had started by the merge. */
export const hadJudge = (checks, mergedAt) => gating(checks, mergedAt).some((c) => checkName(c) === 'judge');

/** A-IDs the body says it closes: `Closes A3`, `Closes **A3**`, `closes A1, A2`; a negation closes nothing. */
export function closedIds(body) {
  const ids = new Set();
  const re = /(?<!\b(?:not|never|no|n't)\s)(?<!n't\s)\bcloses?\b[\s:*]*((?:\bA\d+\b[\s,*]*(?:and\s+|&\s*)?)+)/gi;
  // Inline code is a quotation of the syntax (`closes A1, A2`), not a claim.
  const prose = stripNoise(body).replace(/`[^`\n]*`/g, '');
  for (const m of prose.matchAll(re)) for (const id of m[1].matchAll(/A\d+/gi)) ids.add(id[0].toUpperCase());
  return [...ids];
}

/** Acceptance lines with no proof: closed IDs without a proof line, and proof lines that are `(no test: ...)`. */
export function unprovenLines(body) {
  const lines = parseAcceptance(body);
  const proven = new Set(lines.map((l) => l.id));
  const missing = closedIds(body).filter((id) => !proven.has(id));
  return missing.length + lines.filter((l) => l.kind === 'no-test').length;
}

const chunkIds = (title) => new Set(String(title ?? '').match(CHUNK_ID) ?? []);
const isFixTitle = (title) => /^\s*(fix|revert)\b/i.test(String(title ?? ''));
const names = (pr, n) => new RegExp(`(?:#|/pull/)${n}(?!\\d)`).test(`${pr.title}\n${pr.body ?? ''}`);

/** The later PRs in `prs` (sorted by merge time) that fix `pr` within FIX_DAYS: numbers. */
export function fixesFor(pr, prs) {
  const at = ms(pr.mergedAt);
  const mine = chunkIds(pr.title);
  return prs
    .filter((o) => o.number !== pr.number && ms(o.mergedAt) > at && ms(o.mergedAt) - at <= FIX_DAYS * DAY && isFixTitle(o.title))
    .filter((o) => names(o, pr.number) || [...chunkIds(o.title)].some((c) => mine.has(c)))
    .map((o) => o.number);
}

/** One ledger row per merged PR, oldest merge first. */
export function rows(prs) {
  const sorted = [...prs].sort((a, b) => ms(a.mergedAt) - ms(b.mergedAt) || a.number - b.number);
  return sorted.map((pr) => ({
    number: pr.number,
    title: String(pr.title ?? '').replace(/\s+/g, ' ').trim(),
    mergedAt: pr.mergedAt,
    early: mergedEarly(pr.statusCheckRollup, pr.mergedAt),
    noJudge: !hadJudge(pr.statusCheckRollup, pr.mergedAt),
    unproven: unprovenLines(pr.body),
    fixedBy: fixesFor(pr, sorted),
  }));
}

/** The counts over rows: PRs, then PRs that escaped each way (unproven counts lines). */
export function counts(rs) {
  return {
    merged: rs.length,
    early: rs.filter((r) => r.early).length,
    noJudge: rs.filter((r) => r.noJudge).length,
    unproven: rs.reduce((n, r) => n + r.unproven, 0),
    fixed: rs.filter((r) => r.fixedBy.length).length,
  };
}

/** The one line /digest prints. */
export const summaryLine = (c) => `ledger: ${c.merged} merged, ${c.early} merged before checks finished, ${c.noJudge} with no judge run, ${c.unproven} acceptance lines with no proof, ${c.fixed} fixed within ${FIX_DAYS} days`;

const esc = (s) => String(s).replace(/\|/g, '\\|');
const day = (iso) => String(iso ?? '').slice(0, 10);

/** The ledger file: deterministic for a set of PRs (no run time), so a rerun on the same history is no diff. */
export function render(rs) {
  const c = counts(rs);
  const first = rs[0] ? day(rs[0].mergedAt) : 'none';
  const last = rs.length ? day(rs[rs.length - 1].mergedAt) : 'none';
  return [
    '# Escape ledger',
    '',
    '> Generated by `node scripts/eval/ledger.mjs --write` (run by `/digest`); never edited by hand.',
    '> How often the merge gate was wrong, from merged pull requests alone (spec 61).',
    '',
    `Window: ${c.merged} merged PRs, ${first} to ${last}.`,
    '',
    '| Escape | Count | Meaning |',
    '|---|---|---|',
    `| early | ${c.early} | merged while a started check was unfinished |`,
    `| nojudge | ${c.noJudge} | merged with no \`judge\` check run |`,
    `| unproven | ${c.unproven} | closed A-IDs with no proof line, and \`(no test: ...)\` lines |`,
    `| fixed | ${c.fixed} | a \`fix\` or \`revert\` PR naming it landed within ${FIX_DAYS} days |`,
    '',
    '## Per PR',
    '',
    '| PR | Merged | Early | No judge | Unproven | Fixed by | Title |',
    '|---|---|---|---|---|---|---|',
    ...rs.map((r) => `| #${r.number} | ${day(r.mergedAt)} | ${r.early ? 'yes' : '-'} | ${r.noJudge ? 'yes' : '-'} | ${r.unproven || '-'} | ${r.fixedBy.length ? r.fixedBy.map((n) => `#${n}`).join(' ') : '-'} | ${esc(r.title)} |`),
    '',
    summaryLine(c),
    '',
  ].join('\n');
}

/** Merged PRs through `io.gh(args) -> stdout`: the last `limit`, or everything merged since a date. */
export function fetchMerged({ since = null, last = 10, repo = null, io }) {
  const args = ['pr', 'list', '--state', 'merged', '--json', FIELDS, '--limit', String(since ? 200 : last)];
  if (since) args.push('--search', `merged:>=${since}`);
  if (repo) args.push('--repo', repo);
  const out = JSON.parse(io.gh(args) || '[]');
  if (!Array.isArray(out)) throw new Error('gh pr list did not return a list');
  return out;
}

/** Build the ledger: { rows, counts, text, summary }. */
export function ledger(opts) {
  const rs = rows(fetchMerged(opts));
  const c = counts(rs);
  return { rows: rs, counts: c, text: render(rs), summary: summaryLine(c) };
}

export const ghIo = () => ({
  gh: (args) => {
    const r = spawnSync('gh', args, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(`gh ${args.slice(0, 2).join(' ')} failed: ${(r.stderr || r.error?.message || '').trim()}`);
    return r.stdout;
  },
});

function main(argv, io = ghIo()) {
  const args = argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const since = opt('--since');
  if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    console.error('usage: node scripts/eval/ledger.mjs [--since YYYY-MM-DD | --last <n>] [--repo owner/name] [--write] [--out <file>]');
    return 2;
  }
  const lastN = Number(opt('--last') ?? 10);
  let result;
  try {
    result = ledger({ since, last: Number.isInteger(lastN) && lastN > 0 ? lastN : 10, repo: opt('--repo') ?? process.env.GH_REPO ?? null, io });
  } catch (e) {
    console.error(`ledger: ${e.message}`);
    return 1;
  }
  if (args.includes('--write')) {
    const out = opt('--out') ?? OUT;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, result.text);
  }
  console.log(result.summary);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv));
