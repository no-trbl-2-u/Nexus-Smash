// `nexus upgrade` on an editorial v1 repo (spec 58, A7): a synthetic origin with the measured shape of an hourly cloud
// loop working a content queue (test/helpers/editorial-v1.mjs). The upgrade's result is the kept worktree (the tree
// `--write` will commit; the flag itself lands with 58.8): 52 archive lines (50 + 2 suffixed), 0 open specs, the
// weekly snapshot gate, content queue and survey refill verbatim in march.lanes.md, the cross-link drain in
// iterate.lanes.md, march.yml keeping its cron and ceiling 60, plan-check and the repo's verify green, and a
// predicted lane dispatch, not an idle tick. A half-done clone and a 40-minute-cron clone pass too.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { kitSource, upgrade, rewriteText, render, repoVerify, scopeLint } from '../server/upgrade.mjs';
import { sections } from '../server/kit-text.mjs';
import { editorialV1, marchYml, git, put, commit, state, PHASES } from './helpers/editorial-v1.mjs';

const scratch = [];
after(() => { for (const d of scratch) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); scratch.push(d); return d; };
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const FIX = new URL('./fixtures/upgrade/', import.meta.url);
const devKit = () => kitSource({ bundled: path.join(os.tmpdir(), 'nexus-no-bundle') });
const ARCHIVE_LINE = /^- \d{4}-\d{2}-\d{2} · (\d{2}) · (.*) · ([0-9a-f]{7}(?:\.\.[0-9a-f]{7})?)$/;

function sectionText(file, header) {
  const md = fs.readFileSync(new URL(file, FIX), 'utf8');
  const s = sections(md).sections;
  const i = s.findIndex((x) => x.header === header);
  return [s[i].header, ...s[i].body].join('\n').replace(/\s+$/, '');
}

/** Every A7 clause on one upgraded tree (`wt`) and its report; `cron` is the schedule march.yml must keep. */
function assertEditorial(report, wt, { cron }) {
  // 52 archive lines: 50 numbered + 4b and 15a, the suffix leading the title, each under its parent number.
  assert.equal(report.archive.length, PHASES, report.warnings.join('\n'));
  const lines = read(wt, 'plan/ARCHIVE.md').split('\n').filter((l) => ARCHIVE_LINE.test(l));
  assert.equal(lines.length, PHASES);
  const suffixed = lines.filter((l) => /· \d+[a-z]: /.test(l));
  assert.equal(suffixed.length, 2, suffixed.join('\n'));
  assert.ok(suffixed.some((l) => / · 04 · 4b: Hotfix pass · [0-9a-f]{7}$/.test(l)), suffixed.join('\n'));
  assert.ok(suffixed.some((l) => / · 15 · 15a: Cross-links pass · [0-9a-f]{7}$/.test(l)), suffixed.join('\n'));
  assert.equal(new Set(lines.map((l) => l.match(ARCHIVE_LINE)[1] + (l.match(/· (\d+[a-z]): /)?.[1] ?? ''))).size, PHASES, 'one line per phase');
  assert.ok(lines.some((l) => / · 02 · Section 2 pass · [0-9a-f]{7}\.\.[0-9a-f]{7}$/.test(l)), 'an `a + b` pair archives as a..b');
  assert.ok(lines.some((l) => / · 08 · Section 8 pass · [0-9a-f]{7}$/.test(l)), 'a sha only the bare phase log held');
  assert.ok(lines.every((l) => !/ · [0-9a-f]{7} ·/.test(l) && !/[.;:] · /.test(l)), 'titles are cut clean');
  assert.deepEqual(report.warnings.filter((w) => /parsed|not converted/.test(w)), [], 'every Status row parsed');

  // 0 open specs: no spec stub, and the roadmap's spec table holds no row.
  const specs = fs.readdirSync(path.join(wt, 'plan')).filter((n) => /^\d{2,}-.*\.md$/.test(n));
  assert.deepEqual(specs, []);
  assert.match(read(wt, 'plan/README.md'), /\| # \| Initiative \| Spec \| Status \| Progress \|\n\|---\|---\|---\|---\|---\|\n\n## Editorial calendar/);

  // The loop's own text, verbatim, in the lanes files; the v1 reference inside it rewritten, nothing else.
  const lanes = read(wt, 'skills/march.lanes.md');
  assert.ok(lanes.includes(sectionText('march.pre-v1.md', '### Step 2.5 — Weekly trend snapshot gate')), 'the weekly snapshot gate');
  const queue = rewriteText(sectionText('march.pre-v1.md', '#### 3b.5 Content queue')).text;
  assert.ok(lanes.includes(queue), 'the content queue');
  assert.ok(lanes.includes('When the queue is empty, run `/survey` to refill it from the\nreader questions in `content/inbox/`'), 'the survey refill');
  assert.ok(read(wt, 'skills/iterate.lanes.md').includes(sectionText('iterate.pre-v1.md', '#### H. Cross-link drain')), 'the cross-link drain');
  assert.equal(read(wt, 'skills/survey.md'), '# survey\n\nRefill content/QUEUE.md from content/inbox/, then return.\n', 'the custom skill stays');

  // The workflow keeps the loop's cadence and budget, and the deploy token.
  const yml = read(wt, '.github/workflows/march.yml');
  assert.ok(yml.includes(`- cron: '${cron}'`), yml.split('\n').filter((l) => /cron/.test(l)).join('\n'));
  assert.match(yml, /ceiling=60\b/);
  assert.match(yml, /VERCEL_TOKEN/);
  assert.deepEqual(report.workflow.kept.cron, [cron]);
  assert.equal(report.workflow.kept.ceiling, 60);

  // The gate: plan-check, its test, the repo's own verify and workflow-lint, all green.
  assert.deepEqual(report.gate.map((g) => [g.name, g.ok]), [['plan-check', true], ['plan-check test', true], ['repo verify', true], ['workflow-lint', true]], JSON.stringify(report.gate));
  assert.ok(!report.gate.some((g) => g.skipped), 'the repo\'s verify ran');
  assert.equal(report.loop.mode, 'owner');
}

async function keepUpgrade(local) {
  const { code, report } = await upgrade({ repo: local, today: '2026-10-25', kit: await devKit(), keep: true });
  if (report.worktree) scratch.push(report.worktree);
  assert.equal(code, 0, JSON.stringify(report.gate, null, 2));
  return report;
}

test('A7: an editorial v1 clone upgrades whole, predicts a lane dispatch, and never touches the stale dirty checkout', async () => {
  const r = editorialV1(tmp);
  const before = state(r.local);
  const report = await keepUpgrade(r.local);
  const wt = report.worktree;
  try {
    assert.equal(report.shape, 'v1');
    assertEditorial(report, wt, { cron: '0 * * * *' });
    // Origin's agents.md, not the dirty local one; origin's newest queue commit, not the stale clone's.
    assert.doesNotMatch(read(wt, 'agents.md'), /local edit/);
    assert.ok(!fs.existsSync(path.join(wt, 'scratch.txt')));
    assert.match(read(wt, 'content/QUEUE.md'), /piece 2/);

    // The first dispatch is the carried snapshot lane in owner mode; pr mode alone would idle until the variable is set.
    assert.equal(report.dispatch.kind, 'lane');
    assert.match(report.dispatch.text, /weekly-trend-snapshot-gate/);
    assert.ok(!report.dispatch.idle);
    assert.ok(report.dispatch.live);
    assert.ok(report.dispatch.pr.idle, 'pr mode would idle on zero open specs');
    const text = render(report);
    assert.match(text, /archive \(\+52 lines\)/);
    assert.match(text, /green {2}repo verify/);
  } finally {
    git(r.local, 'worktree', 'remove', '--force', wt);
  }
  assert.deepEqual(state(r.local), before, 'the local checkout is as it was');
});

test('A7: a 40-minute-cron clone keeps its schedule and passes', async () => {
  const r = editorialV1(tmp, { cron: '*/40 * * * *' });
  assert.match(marchYml('*/40 * * * *'), /- cron: '\*\/40 \* \* \* \*'/);
  const report = await keepUpgrade(r.local);
  try {
    assertEditorial(report, report.worktree, { cron: '*/40 * * * *' });
    assert.equal(report.dispatch.kind, 'lane');
  } finally {
    git(r.local, 'worktree', 'remove', '--force', report.worktree);
  }
});

test('A7: a half-done clone (v2 files and lock in place, steps/ and PHASE_CANDIDATES left) finishes Step 5 and passes', async () => {
  // Build the half-done origin from a finished upgrade: the v2 tree, plus the v1 leftovers put back.
  const r = editorialV1(tmp);
  const first = await keepUpgrade(r.local);
  const done = first.worktree;
  const v1plan = read(r.copy, 'plan/steps/01_build_plan.md');
  const half = tmp('nexus-ed-half-');
  git(half, 'clone', '-q', r.bare, '.');
  fs.cpSync(done, half, { recursive: true, force: true, filter: (s) => path.basename(s) !== '.git' });
  git(r.local, 'worktree', 'remove', '--force', done);
  fs.rmSync(path.join(half, 'plan', 'CANDIDATES.md'), { force: true });
  put(half, 'plan/steps/01_build_plan.md', v1plan);
  put(half, 'plan/PHASE_CANDIDATES.md', '# Phase candidates\n\n(None.)\n');
  put(half, 'skills/ship-a-phase.md', '# ship-a-phase\n');
  put(half, '.claude/commands/ship-a-phase.md', 'Read skills/ship-a-phase.md.\n');
  assert.match(read(half, 'plan/nexus.lock'), /shape: chunks/);
  commit(half, 'plan: half an upgrade');
  git(half, 'push', '-q', 'origin', 'main');

  const local = tmp('nexus-ed-half-local-');
  git(local, 'clone', '-q', r.bare, '.');
  const report = await keepUpgrade(local);
  const wt = report.worktree;
  try {
    assert.equal(report.shape, 'half');
    const status = Object.fromEntries(report.files.map((f) => [f.path, f.status]));
    assert.equal(status['plan/steps/01_build_plan.md'], 'retired');
    assert.equal(status['plan/CANDIDATES.md'], 'renamed');
    assert.ok(!fs.existsSync(path.join(wt, 'plan', 'steps')));
    assert.ok(!fs.existsSync(path.join(wt, 'plan', 'PHASE_CANDIDATES.md')));
    assert.ok(!Object.keys(status).some((p) => p.startsWith('skills/march')), 'the carried train and workflow are not touched again');
    assert.equal(report.archive.length, 0, 'no second conversion');
    assert.equal(read(wt, 'plan/ARCHIVE.md').split('\n').filter((l) => ARCHIVE_LINE.test(l)).length, PHASES, 'the archive stays at 52 lines');
    assert.ok(read(wt, 'skills/march.lanes.md').includes(sectionText('march.pre-v1.md', '### Step 2.5 — Weekly trend snapshot gate')));
    assert.match(read(wt, '.github/workflows/march.yml'), /- cron: '0 \* \* \* \*'/);
    assert.deepEqual(report.gate.map((g) => [g.name, g.ok]), [['plan-check', true], ['plan-check test', true], ['repo verify', true], ['workflow-lint', true]], JSON.stringify(report.gate));
    assert.equal(report.dispatch.kind, 'lane', JSON.stringify(report.dispatch));
    assert.match(report.dispatch.text, /weekly-trend-snapshot-gate/);
  } finally {
    git(local, 'worktree', 'remove', '--force', wt);
  }
});

test('the repo\'s own verify joins the gate: absent is no row, a red script is red, an uninstalled package is skipped', () => {
  const d = tmp('nexus-ed-verify-');
  assert.equal(repoVerify(d), null);
  put(d, 'package.json', '{ "scripts": { "verify": "node -e \\"process.exit(0)\\"" } }');
  assert.deepEqual(repoVerify(d), { name: 'repo verify', ok: true, out: '' });
  put(d, 'package.json', '{ "scripts": { "verify": "node -e \\"console.error(1);process.exit(3)\\"" } }');
  assert.equal(repoVerify(d).ok, false);
  put(d, 'package.json', '{ "scripts": { "verify": "vitest" }, "devDependencies": { "vitest": "1" } }');
  const s = repoVerify(d);
  assert.ok(s.ok && s.skipped, JSON.stringify(s));
});

test('workflow-lint problems in workflows the upgrade did not change are a warning; one in march.yml stays red', () => {
  const lint = (lines) => ({ name: 'workflow-lint', ok: false, out: lines.join('\n') });
  const other = '.github/workflows/pr-review.yml: jobs.<id>.env reads github.token (a token is a secret)';
  const mine = '.github/workflows/march.yml: jobs.<id>.env reads secrets in ${{ secrets.X }}';
  const a = scopeLint(lint(['workflow-lint: 2 file(s), 2 problem(s)', other, other]));
  assert.ok(a.row.ok);
  assert.match(a.warning, /2 problem\(s\) in 1 workflow\(s\) the upgrade did not change \(\.github\/workflows\/pr-review\.yml\)/);
  const b = scopeLint(lint([other, mine]));
  assert.equal(b.row.ok, false);
  assert.equal(b.warning, null);
  assert.equal(scopeLint(lint(['workflow-lint crashed'])).row.ok, false, 'no parsable problem: stays red');
  assert.equal(scopeLint({ name: 'plan-check', ok: false, out: other }).row.ok, false);
});
