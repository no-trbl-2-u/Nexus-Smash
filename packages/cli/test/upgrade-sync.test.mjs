// `nexus upgrade` on a v2 repo (spec 58, A11): the sync to the latest kit. Untouched kit files are replaced,
// customised ones three-way merged, a conflict goes to an assisted merge shown as a diff and kept only with a green
// gate, new kit content is listed and added with new knobs at their conservative values, lanes files and custom skills
// are untouched, and the lock's ref: moves in one `plan: sync to nexus <version>` commit. Fixtures: an untouched file,
// a clean merge, a conflict, a new skill. Real git in temp folders (a kit repo with a v2.0.0 tag and a later commit, a
// bare origin, a local clone), offline; the helper model is a stub.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { upgrade, render, runUpgrade } from '../server/upgrade.mjs';
import { kitIdentity, mergeThree, modelAssist, movedLock, newKnobs, openBase, syncBranch, syncSubject, unifiedDiff } from '../server/upgrade-sync.mjs';

const scratch = [];
after(() => { for (const d of scratch) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); scratch.push(d); return d; };

const env = { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com' };
const git = (cwd, ...args) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { cwd, env, encoding: 'utf8', stdio: 'pipe' }).trim();
const put = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const commit = (dir, msg) => { git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', msg); return git(dir, 'rev-parse', 'HEAD'); };
const sink = () => { const lines = []; const f = (s) => lines.push(s); f.text = () => lines.join('\n'); return f; };

// The kit at v2.0.0 (base) and now (theirs).
const BASE = {
  'skills/keep.md': '# keep\n\nThe kit\'s step. Support: triage-only stays the default.\n',
  'skills/custom.md': '# custom\n\nkit para one\n\nkit para two\n\nkit para three\n',
  'skills/clash.md': '# clash\n\nstep: run the gate\n\nend\n',
  'skills/march.lanes.md': '# march lanes\n\n(none)\n',
};
const THEIRS = {
  'skills/keep.md': '# keep\n\nThe kit\'s step, revised. Support: triage-only stays the default.\n',
  'skills/custom.md': '# custom\n\nkit para one, revised\n\nkit para two\n\nkit para three\n',
  'skills/clash.md': '# clash\n\nstep: run the gate, then land\n\nend\n',
  'skills/march.lanes.md': '# march lanes\n\n(none, revised seed)\n',
  'skills/fresh.md': '# fresh\n\nA skill the kit did not ship at v2.0.0.\n',
};
// gone.md: a kit file the repo deleted after adopting; the kit changed it since.
BASE['skills/gone.md'] = '# gone\n\nThe kit\'s.\n';
THEIRS['skills/gone.md'] = '# gone\n\nThe kit\'s, revised.\n';
// The repo's copies: keep.md untouched, custom.md and clash.md customised, its own lanes and a custom skill.
const OURS = {
  'skills/keep.md': BASE['skills/keep.md'],
  'skills/custom.md': '# custom\n\nkit para one\n\nkit para two\n\nour own para three\n',
  'skills/clash.md': '# clash\n\nstep: run the gate twice\n\nend\n',
  'skills/march.lanes.md': '# march lanes\n\n## lane: snapshot\n\nOur weekly snapshot gate.\n',
  'skills/mine.md': '# mine\n\nA skill the kit never shipped.\n',
};
const LIST = ['skills/keep.md', 'skills/custom.md', 'skills/clash.md', 'skills/march.lanes.md', 'skills/fresh.md', 'skills/gone.md']
  .map((r) => ({ kit: `templates/${r}`, repo: r, kind: r.endsWith('.lanes.md') ? 'lane' : 'skill' }));
// The repo's own gate: red when a skill says BREAKS.
const PLAN_CHECK = "import fs from 'node:fs';\nconst bad = fs.readdirSync('skills').filter((n) => fs.readFileSync('skills/' + n, 'utf8').includes('BREAKS'));\nif (bad.length) { console.error('BREAKS in ' + bad.join(', ')); process.exit(1); }\nconsole.log('plan-check ok');\n";

function kitRepo() {
  const dir = tmp('nexus-sync-kit-');
  git(dir, 'init', '-q', '-b', 'main');
  for (const [r, t] of Object.entries(BASE)) put(dir, `templates/${r}`, t);
  put(dir, 'templates/plan/nexus.lock', 'kit: nexus\nversion: 2.1.0\nref: v2.1.0\nshape: chunks\n');
  const base = commit(dir, 'kit at v2.0.0');
  git(dir, 'tag', 'v2.0.0');
  for (const [r, t] of Object.entries(THEIRS)) put(dir, `templates/${r}`, t);
  const head = commit(dir, 'kit now');
  return { dir, base, head, kit: { root: path.join(dir, 'templates'), files: LIST, text: null, from: 'templates', git: dir, id: { version: '2.1.0', ref: head } } };
}

/** A v2 repo on the kit at v2.0.0, pushed to a bare origin, cloned locally. */
function v2Repo({ ref = 'v2.0.0', extra = null } = {}) {
  const bare = tmp('nexus-sync-origin-');
  git(bare, 'init', '-q', '--bare', '-b', 'main');
  const seed = tmp('nexus-sync-seed-');
  git(seed, 'init', '-q', '-b', 'main');
  git(seed, 'remote', 'add', 'origin', bare);
  for (const [r, t] of Object.entries(OURS)) put(seed, r, t);
  put(seed, 'plan/nexus.lock', `kit: nexus\nversion: 2.0.0\nref: ${ref}\nshape: chunks\nadopted: 2026-10-20\n`);
  put(seed, 'plan/bearings.md', '# Bearings\n\n- Promote: aged\n');
  put(seed, 'scripts/plan-check.mjs', PLAN_CHECK);
  if (extra) extra(seed);
  const sha = commit(seed, 'v2 repo');
  git(seed, 'push', '-q', 'origin', 'main');
  const local = tmp('nexus-sync-local-');
  git(local, 'clone', '-q', bare, '.');
  git(local, 'config', 'user.name', 'T');
  git(local, 'config', 'user.email', 't@example.com');
  git(local, 'config', 'core.autocrlf', 'false');
  git(local, 'config', 'commit.gpgsign', 'false');
  return { bare, local, sha };
}

const RESOLVED = '# clash\n\nstep: run the gate twice, then land\n\nend\n';
const stubAssist = (text = RESOLVED) => {
  const calls = [];
  const fn = async (a) => { calls.push(a); return { text, reasons: ['hunk 1: kept "twice", the repo runs its gate twice'] }; };
  fn.calls = calls;
  return fn;
};
const state = (dir) => ({ status: git(dir, 'status', '--porcelain'), head: git(dir, 'rev-parse', 'HEAD'), worktrees: git(dir, 'worktree', 'list', '--porcelain') });
const statusOf = (report) => Object.fromEntries(report.files.map((f) => [f.path, f.status]));

test('three-way pieces: merge-file clean and conflicted, the diff, the lock, new knobs', () => {
  const clean = mergeThree({ base: BASE['skills/custom.md'], ours: OURS['skills/custom.md'], theirs: THEIRS['skills/custom.md'] });
  assert.equal(clean.conflicts, 0);
  assert.equal(clean.text, '# custom\n\nkit para one, revised\n\nkit para two\n\nour own para three\n');
  const clash = mergeThree({ base: BASE['skills/clash.md'], ours: OURS['skills/clash.md'], theirs: THEIRS['skills/clash.md'] });
  assert.equal(clash.conflicts, 1);
  assert.match(clash.text, /<<<<<<< ours\nstep: run the gate twice\n\|\|\|\|\|\|\| base\nstep: run the gate\n=======\nstep: run the gate, then land\n>>>>>>> theirs/);
  const d = unifiedDiff('a\nb\n', 'a\nc\n', 'skills/x.md', 'assisted');
  assert.match(d, /^--- ours\/skills\/x\.md\n\+\+\+ assisted\/skills\/x\.md\n@@/);
  assert.match(d, /\n-b\n\+c$/);
  assert.equal(unifiedDiff('same\n', 'same\n', 'x'), '');
  assert.equal(movedLock('kit: nexus\nversion: 2.0.0\nref: v2.0.0\nshape: chunks\n', { version: '2.1.0', ref: 'abc' }), 'kit: nexus\nversion: 2.1.0\nref: abc\nshape: chunks\n');
  assert.equal(movedLock('kit: nexus\nshape: chunks\n', { version: '2.1.0', ref: 'abc' }), 'kit: nexus\nshape: chunks\nversion: 2.1.0\nref: abc\n');
  const fresh = newKnobs('Support: triage-only\nvars.NEXUS_CADENCE\n## Generators\n').map((k) => k.knob);
  assert.ok(!fresh.includes('Support') && !fresh.includes('NEXUS_CADENCE') && !fresh.includes('Generators'), fresh.join(', '));
  assert.ok(fresh.includes('Promote') && fresh.includes('NEXUS_IDLE_BACKOFF'), fresh.join(', '));
});

test('the kit identity and the base: a tag is its version, a later commit carries its sha; a bundled kit fetches ref', () => {
  const k = kitRepo();
  assert.deepEqual(kitIdentity(k.dir), { version: `2.1.0+${k.head.slice(0, 7)}`, ref: k.head });
  git(k.dir, 'tag', 'v2.1.0');
  assert.deepEqual(kitIdentity(k.dir), { version: '2.1.0', ref: k.head });
  const own = openBase(k.kit, 'v2.0.0');
  assert.equal(own.commit, k.base);
  assert.equal(own.read('templates/skills/keep.md'), BASE['skills/keep.md']);
  assert.equal(own.read('templates/skills/fresh.md'), null, 'a file the kit did not hold at ref: reads as null');
  own.close();
  const fetched = openBase({ root: tmp('nexus-sync-bundled-'), files: [], from: 'bundled' }, 'v2.0.0', { url: pathToFileURL(k.dir).href });
  assert.equal(fetched.error, undefined, fetched.error);
  assert.equal(fetched.commit, k.base);
  assert.equal(fetched.read('templates/skills/clash.md'), BASE['skills/clash.md']);
  fetched.close();
  assert.match(openBase(k.kit, 'v9.9.9').error, /not in/);
});

test('the dry run: untouched replaced, a clean merge, an assisted conflict as a diff, a new skill, lanes and custom skills untouched', async () => {
  const k = kitRepo();
  const r = v2Repo();
  const before = state(r.local);
  const assist = stubAssist();
  const { code, report } = await upgrade({ repo: r.local, kit: k.kit, assist, today: '2026-10-27' });
  assert.equal(code, 0, JSON.stringify(report, null, 2));
  assert.deepEqual(state(r.local), before, 'the local checkout is not touched');
  assert.equal(report.worktree, null);
  assert.equal(report.commit, null);
  assert.equal(report.dry, true);
  assert.deepEqual(report.sync, { from: 'v2.0.0', to: k.kit.id, base: k.base });
  const st = statusOf(report);
  assert.equal(st['skills/keep.md'], 'replaced', 'an untouched file');
  assert.equal(st['skills/custom.md'], 'merged', 'a clean merge');
  assert.equal(st['skills/clash.md'], 'assisted', 'a conflict, resolved by the assisted merge with a green gate');
  assert.equal(st['skills/fresh.md'], 'added', 'a new skill');
  assert.equal(st['skills/march.lanes.md'], 'kept-custom', 'the lanes file');
  assert.equal(st['skills/mine.md'], undefined, 'a custom skill is never touched');
  assert.equal(st['plan/nexus.lock'], 'replaced');
  assert.deepEqual(report.added, [{ path: 'skills/fresh.md', kind: 'skill' }]);
  // The assisted merge got base, theirs and ours (placeholders filled) and the conflicted text.
  assert.equal(assist.calls.length, 1);
  assert.deepEqual([assist.calls[0].path, assist.calls[0].base, assist.calls[0].ours, assist.calls[0].theirs], ['skills/clash.md', BASE['skills/clash.md'], OURS['skills/clash.md'], THEIRS['skills/clash.md']]);
  assert.match(assist.calls[0].marked, /<<<<<<< ours/);
  const assisted = report.merges.find((m) => m.path === 'skills/clash.md');
  assert.equal(assisted.kind, 'assisted');
  assert.ok(assisted.applied);
  assert.match(assisted.diff, /-step: run the gate twice\n\+step: run the gate twice, then land/);
  assert.deepEqual(assisted.reasons, ['hunk 1: kept "twice", the repo runs its gate twice']);
  assert.match(report.merges.find((m) => m.path === 'skills/custom.md').diff, /-kit para one\n\+kit para one, revised/);
  // New knobs only (the base kit named Support:), at their conservative values; the repo's own line is kept.
  const written = report.knobs.filter((x) => x.status === 'written').map((x) => `${x.knob} ${x.value}`);
  assert.ok(!report.knobs.some((x) => x.knob === 'Support'), 'a knob the kit named at ref: is not new');
  assert.ok(written.includes('stall_action alert') && written.includes('UI none'), written.join(', '));
  assert.deepEqual(report.knobs.find((x) => x.knob === 'Promote'), { knob: 'Promote', at: 'bearings', value: 'aged', status: 'kept' });
  assert.deepEqual(report.gate.map((g) => [g.name, g.ok]), [['plan-check', true]]);
  const text = render(report);
  for (const want of ['sync to the latest kit, dry run', 'kit      v2.0.0 -> nexus 2.1.0', 'replaced', 'merged', 'assisted  skills/clash.md', 'kept from ours: hunk 1', '+step: run the gate twice, then land', 'new kit content (1)', '+ skills/fresh.md  (skill)', 'new knobs (conservative', 'green  plan-check', '--write commits this']) {
    assert.ok(text.includes(want), `${want}\n---\n${text}`);
  }
});

test('--write: one `plan: sync to nexus <version>` commit on its branch, the lock\'s ref moved, lanes and custom skills untouched', async () => {
  const k = kitRepo();
  const r = v2Repo();
  const before = state(r.local);
  const out = sink();
  const code = await runUpgrade(['--repo', r.local, '--write'], { out, err: out, today: '2026-10-27', assistOf: () => stubAssist(), seams: { kit: k.kit } });
  assert.equal(code, 0, out.text());
  assert.deepEqual(state(r.local), before, 'the local checkout\'s branch and files are as they were');
  const branch = syncBranch('2.1.0');
  assert.equal(git(r.local, 'log', '--format=%s', `origin/main..${branch}`), syncSubject('2.1.0'), 'one commit');
  assert.equal(syncSubject('2.1.0'), 'plan: sync to nexus 2.1.0');
  assert.doesNotMatch(git(r.local, 'log', '-1', '--format=%B', branch), /Co-Authored-By|Cloud-Run/);
  const at = (rel) => git(r.local, 'show', `${branch}:${rel}`);
  assert.equal(`${at('skills/keep.md')}\n`, THEIRS['skills/keep.md']);
  assert.equal(`${at('skills/custom.md')}\n`, '# custom\n\nkit para one, revised\n\nkit para two\n\nour own para three\n');
  assert.equal(`${at('skills/clash.md')}\n`, RESOLVED);
  assert.equal(`${at('skills/fresh.md')}\n`, THEIRS['skills/fresh.md']);
  const lock = at('plan/nexus.lock');
  assert.match(lock, new RegExp(`^ref: ${k.head}$`, 'm'));
  assert.match(lock, /^version: 2\.1\.0$/m);
  assert.match(at('plan/bearings.md'), /^- Promote: aged$/m);
  assert.match(at('plan/bearings.md'), /^- stall_action: alert$/m);
  const changed = git(r.local, 'diff', '--name-only', `origin/main..${branch}`).split('\n').sort();
  assert.deepEqual(changed, ['plan/bearings.md', 'plan/nexus.lock', 'skills/clash.md', 'skills/custom.md', 'skills/fresh.md', 'skills/keep.md'], 'no lanes file, no custom skill');
  assert.match(out.text(), new RegExp(`committed [0-9a-f]{7} plan: sync to nexus 2\\.1\\.0 on ${branch.replace(/[.+]/g, '\\$&')}`));
  assert.equal(git(r.local, 'worktree', 'list').split('\n').length, 1, 'the worktree is removed');
});

test('an assisted merge that turns the gate red stays as ours and is listed; with no helper the conflict diff is listed', async () => {
  const k = kitRepo();
  const r = v2Repo();
  const { code, report } = await upgrade({ repo: r.local, kit: k.kit, assist: stubAssist('# clash\n\nBREAKS\n\nend\n'), write: true, today: '2026-10-27' });
  assert.equal(code, 0, JSON.stringify(report, null, 2));
  assert.equal(statusOf(report)['skills/clash.md'], 'assisted (left as ours)');
  const m = report.merges.find((x) => x.path === 'skills/clash.md');
  assert.equal(m.applied, false);
  assert.match(m.diff, /\+BREAKS/, 'the diff is still shown');
  assert.ok(report.warnings.some((w) => /gate went red with the assisted merge of skills\/clash\.md/.test(w)), report.warnings.join('\n'));
  assert.deepEqual(report.gate.map((g) => g.ok), [true], 'the committed tree is green');
  const branch = syncBranch('2.1.0');
  assert.equal(`${git(r.local, 'show', `${branch}:skills/clash.md`)}\n`, OURS['skills/clash.md'], 'left as ours');
  assert.equal(`${git(r.local, 'show', `${branch}:skills/keep.md`)}\n`, THEIRS['skills/keep.md'], 'the rest still synced');

  const r2 = v2Repo();
  const plain = await upgrade({ repo: r2.local, kit: k.kit, assist: null, today: '2026-10-27' });
  assert.equal(plain.code, 0);
  assert.equal(statusOf(plain.report)['skills/clash.md'], 'conflict (left as ours)');
  const c = plain.report.merges.find((x) => x.path === 'skills/clash.md');
  assert.equal(c.kind, 'conflict');
  assert.match(c.diff, /\+<<<<<<< ours/);
  assert.match(render(plain.report), /conflict  skills\/clash\.md  \(left as ours\)/);
});

test('a red gate before the assisted merge keeps the worktree and commits nothing; a lock at the kit\'s ref is already current', async () => {
  const k = kitRepo();
  const r = v2Repo();
  const red = await upgrade({ repo: r.local, kit: k.kit, write: true, gateOf: () => [{ name: 'plan-check', ok: false, out: 'no' }], today: '2026-10-27' });
  assert.equal(red.code, 1);
  assert.ok(red.report.worktree && fs.existsSync(red.report.worktree));
  assert.equal(red.report.commit, null);
  assert.throws(() => git(r.local, 'rev-parse', '--verify', syncBranch('2.1.0')), 'no sync branch');
  assert.match(render(red.report), /worktree kept: /);
  git(r.local, 'worktree', 'remove', '--force', red.report.worktree);

  const cur = v2Repo({ ref: k.head });
  const done = await upgrade({ repo: cur.local, kit: k.kit, today: '2026-10-27' });
  assert.equal(done.code, 0);
  assert.equal(done.report.message, 'already on the latest kit');
  assert.match(render(done.report), /already on the latest kit: .*Nothing to sync\./);
});

test('--write on a v1 repo is refused (exit 2); the helper model\'s answer is parsed, a bad one is no merge', async () => {
  const bare = tmp('nexus-sync-v1o-');
  git(bare, 'init', '-q', '--bare', '-b', 'main');
  const seed = tmp('nexus-sync-v1s-');
  git(seed, 'init', '-q', '-b', 'main');
  git(seed, 'remote', 'add', 'origin', bare);
  put(seed, 'plan/steps/01_build_plan.md', '# 01 — Build plan\n\n## Status (at-a-glance)\n\n- [ ] Phase 1 — Start\n');
  commit(seed, 'v1');
  git(seed, 'push', '-q', 'origin', 'main');
  const local = tmp('nexus-sync-v1l-');
  git(local, 'clone', '-q', bare, '.');
  const out = sink();
  assert.equal(await runUpgrade(['--repo', local, '--write'], { out, err: out }), 2);
  assert.match(out.text(), /--write on a v1 or half-done repo is not in this release yet/);

  const seen = [];
  const good = modelAssist({ runOnce: async (o) => { seen.push(o); return { is_error: false, result: 'Here:\n{"merged": "a\\nb\\n", "reasons": ["kept b"]}' }; } });
  assert.deepEqual(await good({ path: 'x.md', base: 'a\n', ours: 'a\nb\n', theirs: 'a\nc\n' }), { text: 'a\nb\n', reasons: ['kept b'] });
  assert.match(seen[0].prompt, /=== BASE ===\na\n\n=== THEIRS ===\na\nc\n\n=== OURS ===\na\nb\n/);
  assert.equal(seen[0].permissionMode, 'plan');
  const bad = modelAssist({ runOnce: async () => ({ is_error: false, result: 'no json here' }) });
  assert.equal(await bad({ path: 'x', base: '', ours: '', theirs: '' }), null);
  const err = modelAssist({ runOnce: async () => ({ is_error: true, result: 'boom' }) });
  assert.equal(await err({ path: 'x', base: '', ours: '', theirs: '' }), null);
});

// Review findings on PR #10, each red first.

test('a kit file the repo deleted after ref: stays deleted and is listed, with a warning when the kit changed it', async () => {
  const k = kitRepo();
  const r = v2Repo();
  const { code, report } = await upgrade({ repo: r.local, kit: k.kit, assist: stubAssist(), write: true, today: '2026-10-27' });
  assert.equal(code, 0, JSON.stringify(report, null, 2));
  assert.equal(statusOf(report)['skills/gone.md'], 'kept-deleted');
  assert.ok(!report.added.some((a) => a.path === 'skills/gone.md'), 'not new kit content');
  assert.ok(report.warnings.some((w) => /skills\/gone\.md: .*deleted.*the kit changed it/.test(w)), report.warnings.join('\n'));
  assert.throws(() => git(r.local, 'show', `${syncBranch('2.1.0')}:skills/gone.md`), 'not resurrected');
});

test('the sync commit runs no repo hook; an existing branch with work on it is refused, a previous sync\'s branch is replaced', async () => {
  const k = kitRepo();
  const r = v2Repo();
  const hook = path.join(r.local, '.git', 'hooks', 'pre-commit');
  fs.writeFileSync(hook, '#!/bin/sh\necho hook ran >&2\nexit 1\n');
  fs.chmodSync(hook, 0o755);
  const first = await upgrade({ repo: r.local, kit: k.kit, assist: stubAssist(), write: true, today: '2026-10-27' });
  assert.equal(first.code, 0, JSON.stringify(first.report.error || first.report.gate));
  assert.ok(first.report.commit, 'committed despite a failing repo hook');
  // A rerun replaces its own earlier result (only sync commits on the branch).
  const again = await upgrade({ repo: r.local, kit: k.kit, assist: stubAssist(), write: true, today: '2026-10-27' });
  assert.equal(again.code, 0, again.report.error);
  const branch = syncBranch('2.1.0');
  assert.equal(git(r.local, 'log', '--format=%s', `origin/main..${branch}`), syncSubject('2.1.0'));
  // Someone's own commit on the branch: refused, the branch kept as it was.
  fs.rmSync(hook);
  const wt = tmp('nexus-sync-own-');
  fs.rmSync(wt, { recursive: true, force: true });
  git(r.local, 'worktree', 'add', '-q', wt, branch);
  put(wt, 'notes.md', 'mine\n');
  git(wt, 'add', '-A');
  git(wt, 'commit', '-q', '-m', 'docs: my own note');
  const tip = git(r.local, 'rev-parse', branch);
  git(r.local, 'worktree', 'remove', '--force', wt);
  const refused = await upgrade({ repo: r.local, kit: k.kit, assist: stubAssist(), write: true, today: '2026-10-27' });
  assert.equal(refused.code, 2);
  assert.match(refused.report.error, /nexus\/upgrade-2\.1\.0 already exists with commits that are not a sync/);
  assert.equal(git(r.local, 'rev-parse', branch), tip, 'the branch is untouched');
  assert.equal(git(r.local, 'worktree', 'list').split('\n').length, 1);
});

test('an empty or degenerate assisted merge is rejected: the file stays ours, with a warning', async () => {
  const k = kitRepo();
  for (const text of ['', 'x\n']) {
    const r = v2Repo();
    const { code, report } = await upgrade({ repo: r.local, kit: k.kit, assist: stubAssist(text), write: true, today: '2026-10-27' });
    assert.equal(code, 0, JSON.stringify(report.error));
    assert.equal(statusOf(report)['skills/clash.md'], 'conflict (left as ours)', JSON.stringify(text));
    assert.ok(report.warnings.some((w) => /skills\/clash\.md: the assisted merge dropped most of both sides/.test(w)), report.warnings.join('\n'));
    assert.equal(`${git(r.local, 'show', `${syncBranch('2.1.0')}:skills/clash.md`)}\n`, OURS['skills/clash.md']);
  }
});

test('placeholders fill literally (a $& in a name stays); a CRLF file comes back CRLF', async () => {
  const { fill } = await import('../server/workflow-merge.mjs');
  assert.equal(fill('<PROJECT> <PACKAGE_MANAGER> <DEFAULT_BRANCH>', { project: 'a$&b$$', pm: 'n$1', branch: 'm$`' }), 'a$&b$$ n$1 m$`');
  const k = kitRepo();
  const r = v2Repo({ extra: (seed) => {
    put(seed, 'skills/keep.md', OURS['skills/keep.md'].replace(/\n/g, '\r\n'));
    put(seed, 'skills/custom.md', OURS['skills/custom.md'].replace(/\n/g, '\r\n'));
  } });
  const { code, report } = await upgrade({ repo: r.local, kit: k.kit, assist: stubAssist(), write: true, today: '2026-10-27' });
  assert.equal(code, 0, JSON.stringify(report.error));
  const st = statusOf(report);
  assert.equal(st['skills/keep.md'], 'replaced', 'CRLF is not a customisation');
  assert.equal(st['skills/custom.md'], 'merged');
  const raw = (rel) => execFileSync('git', ['show', `${syncBranch('2.1.0')}:${rel}`], { cwd: r.local, encoding: 'utf8' });
  assert.equal(raw('skills/keep.md'), THEIRS['skills/keep.md'].replace(/\n/g, '\r\n'));
  assert.equal(raw('skills/custom.md'), '# custom\r\n\r\nkit para one, revised\r\n\r\nkit para two\r\n\r\nour own para three\r\n');
});

test('no git identity: the sync says so before any work, instead of a bare commit failure', async () => {
  const k = kitRepo();
  const r = v2Repo();
  git(r.local, 'config', '--unset', 'user.name');
  git(r.local, 'config', '--unset', 'user.email');
  git(r.local, 'config', 'user.useConfigOnly', 'true');
  const empty = path.join(tmp('nexus-sync-cfg-'), 'gitconfig');
  fs.writeFileSync(empty, '');
  const keys = ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'EMAIL'];
  const saved = Object.fromEntries(keys.map((x) => [x, process.env[x]]));
  for (const x of keys) delete process.env[x];
  process.env.GIT_CONFIG_GLOBAL = empty;
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  try {
    const { code, report } = await upgrade({ repo: r.local, kit: k.kit, assist: stubAssist(), write: true, today: '2026-10-27' });
    assert.equal(code, 2);
    assert.match(report.error, /no git identity.*user\.name.*user\.email/);
  } finally {
    for (const x of keys) { if (saved[x] == null) delete process.env[x]; else process.env[x] = saved[x]; }
  }
});
