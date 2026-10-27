// `nexus upgrade --repo owner/name` and `--pr` (spec 58, A13): a repo on GitHub is upgraded with no local checkout: a
// blobless temporary clone, the same report as a local run, and with --pr a pushed `nexus/upgrade-<version>` branch and a
// pull request whose body is the report; without push access it forks; a second run updates the open pull request
// instead of opening another; a red gate opens nothing. Real git over local bare remotes (clone and fork URLs are
// injected, so no run reaches GitHub); `gh` is a stub holding the pull requests in a map. The helper model is a stub.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { upgrade, render, runUpgrade, COMMIT_SUBJECT } from '../server/upgrade.mjs';
import { parseRepo, slugOfUrl, renderPrBody, defuse, cloneBlobless, cloneUrlOf as githubUrl } from '../server/upgrade-remote.mjs';
import { syncBranch, syncSubject } from '../server/upgrade-sync.mjs';

const scratch = [];
after(() => { for (const d of scratch) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); scratch.push(d); return d; };

// A clone has no local git config: the commit's author comes from here (restored by the process ending).
Object.assign(process.env, { GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com' });
const git = (cwd, ...args) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
const put = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const commit = (dir, msg) => { git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', msg); return git(dir, 'rev-parse', 'HEAD'); };
const sink = () => { const lines = []; const f = (s) => lines.push(s); f.text = () => lines.join('\n'); return f; };
const bareRepo = (p) => { const d = tmp(p); git(d, 'init', '-q', '--bare', '-b', 'main'); git(d, 'config', 'uploadpack.allowFilter', 'true'); git(d, 'config', 'uploadpack.allowAnySHA1InWant', 'true'); return d; };
const clones = () => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('nexus-upgrade-clone-'));

const BASE = { 'skills/clash.md': '# clash\n\nstep: run the gate\n\nend\n', 'skills/keep.md': '# keep\n\nThe kit\'s step.\n', 'skills/custom.md': '# custom\n\nkit one\n\nkit two\n\nkit three\n' };
const THEIRS = { 'skills/clash.md': '# clash\n\nstep: run the gate, then land\n\nend\n', 'skills/keep.md': '# keep\n\nThe kit\'s step, revised.\n', 'skills/custom.md': '# custom\n\nkit one, revised\n\nkit two\n\nkit three\n', 'skills/fresh.md': '# fresh\n\nNew in the kit.\n' };
const OURS = { 'skills/clash.md': '# clash\n\nstep: run the gate twice\n\nend\n', 'skills/keep.md': BASE['skills/keep.md'], 'skills/custom.md': '# custom\n\nkit one\n\nkit two\n\nour three\n' };
const LIST = ['skills/keep.md', 'skills/custom.md', 'skills/fresh.md', 'skills/clash.md'].map((r) => ({ kit: `templates/${r}`, repo: r, kind: 'skill' }));
const PLAN_CHECK = "import fs from 'node:fs';\nconst bad = fs.readdirSync('skills').filter((n) => fs.readFileSync('skills/' + n, 'utf8').includes('BREAKS'));\nif (bad.length) { console.error('BREAKS in ' + bad.join(', ')); process.exit(1); }\nconsole.log('plan-check ok');\n";

function kitRepo() {
  const dir = tmp('nexus-rem-kit-');
  git(dir, 'init', '-q', '-b', 'main');
  for (const [r, t] of Object.entries(BASE)) put(dir, `templates/${r}`, t);
  put(dir, 'templates/plan/nexus.lock', 'kit: nexus\nversion: 2.1.0\nref: v2.1.0\nshape: chunks\n');
  const base = commit(dir, 'kit at v2.0.0');
  git(dir, 'tag', 'v2.0.0');
  for (const [r, t] of Object.entries(THEIRS)) put(dir, `templates/${r}`, t);
  const head = commit(dir, 'kit now');
  return { dir, base, head, kit: { root: path.join(dir, 'templates'), files: LIST, text: null, from: 'templates', git: dir, id: { version: '2.1.0', ref: head } } };
}

/** A v2 repo on the kit at v2.0.0 in a bare origin that allows blobless clones; `local` is a normal clone of it. */
function v2Origin({ extra = null } = {}) {
  const bare = bareRepo('nexus-rem-origin-');
  const seed = tmp('nexus-rem-seed-');
  git(seed, 'init', '-q', '-b', 'main');
  git(seed, 'remote', 'add', 'origin', bare);
  for (const [r, t] of Object.entries(OURS)) put(seed, r, t);
  put(seed, 'plan/nexus.lock', 'kit: nexus\nversion: 2.0.0\nref: v2.0.0\nshape: chunks\nadopted: 2026-10-20\n');
  put(seed, 'plan/bearings.md', '# Bearings\n\n- Promote: aged\n');
  put(seed, 'scripts/plan-check.mjs', PLAN_CHECK);
  if (extra) extra(seed);
  commit(seed, 'v2 repo');
  git(seed, 'push', '-q', 'origin', 'main');
  const local = tmp('nexus-rem-local-');
  git(local, 'clone', '-q', bare, '.');
  return { bare, seed, local };
}
/** owner/name -> the bare remote (file URL). */
const urls = (map) => (slug) => {
  if (!map[slug]) throw new Error(`the test has no remote for ${slug}`);
  return new URL(`file:///${map[slug].replace(/\\/g, '/').replace(/^\//, '')}`).href;
};

test('--repo takes owner/name or a GitHub URL; a folder wins; anything else is refused', () => {
  assert.deepEqual(parseRepo('acme/notes'), { slug: 'acme/notes', owner: 'acme', name: 'notes' });
  assert.equal(parseRepo('https://github.com/acme/notes').slug, 'acme/notes');
  assert.equal(parseRepo('https://github.com/acme/notes.git').slug, 'acme/notes');
  assert.equal(parseRepo('git@github.com:acme/notes.git').slug, 'acme/notes');
  assert.equal(parseRepo('github.com/acme/notes/').slug, 'acme/notes');
  assert.equal(parseRepo('notes'), null);
  assert.equal(parseRepo('C:\\work\\notes'), null);
  assert.equal(parseRepo('https://example.com/acme/notes'), null);
  assert.equal(slugOfUrl('https://x-access-token:abc@github.com/acme/notes.git'), 'acme/notes');
  assert.equal(slugOfUrl('/tmp/origin.git'), null);
  assert.equal(githubUrl('acme/notes'), 'https://github.com/acme/notes.git');
});

test('the temporary clone is blobless and removed after; the report is the one a local run prints', async () => {
  const k = kitRepo();
  const o = v2Origin();
  const cloneUrlOf = urls({ 'acme/notes': o.bare });
  const probe = cloneBlobless('acme/notes', { cloneUrl: cloneUrlOf });
  try {
    assert.equal(git(probe.dir, 'config', 'remote.origin.partialclonefilter'), 'blob:none', 'a blobless clone');
    assert.equal(git(probe.dir, 'config', 'remote.origin.promisor'), 'true');
    assert.equal(probe.branch, 'main');
    assert.equal(probe.sha, git(o.bare, 'rev-parse', 'main'));
    assert.doesNotMatch(probe.url, /@/);
  } finally { probe.remove(); }
  assert.ok(!fs.existsSync(probe.dir), 'removed');

  const before = clones();
  const remote = await upgrade({ repo: '.', remote: 'acme/notes', cloneUrlOf, kit: k.kit, assist: null, today: '2026-10-27' });
  const local = await upgrade({ repo: o.local, kit: k.kit, assist: null, today: '2026-10-27' });
  assert.equal(remote.code, 0, JSON.stringify(remote.report, null, 2));
  assert.deepEqual(clones(), before, 'no clone left behind');
  assert.equal(remote.report.worktree, null);
  assert.equal(remote.report.repo, 'acme/notes');
  assert.equal(remote.report.dry, true);
  for (const field of ['sync', 'files', 'added', 'merges', 'knobs', 'warnings', 'gate']) assert.deepEqual(remote.report[field], local.report[field], field);
  assert.ok(remote.report.files.some((f) => f.path === 'skills/fresh.md' && f.status === 'added'));
  // The same text apart from where the repo is.
  const strip = (s) => s.split('\n').filter((l) => !/^  (repo|origin) /.test(l)).join('\n');
  assert.equal(strip(render(remote.report)), strip(render(local.report)));
  assert.match(render(remote.report), /^  repo     acme\/notes$/m);
});

test('runUpgrade: --repo owner/name prints the dry run; --write has nothing to write into; a non-repo is refused', async () => {
  const k = kitRepo();
  const o = v2Origin();
  const cloneUrlOf = urls({ 'acme/notes': o.bare });
  const out = sink();
  assert.equal(await runUpgrade(['--repo', 'acme/notes'], { out, err: out, today: '2026-10-27', assistOf: () => null, seams: { kit: k.kit, cloneUrlOf } }), 0, out.text());
  assert.match(out.text(), /sync to the latest kit, dry run/);
  assert.match(out.text(), /repo     acme\/notes/);
  const w = sink();
  assert.equal(await runUpgrade(['--repo', 'acme/notes', '--write'], { out: w, err: w, today: '2026-10-27', seams: { kit: k.kit, cloneUrlOf } }), 2);
  assert.match(w.text(), /--write needs a checkout/);
  const bad = sink();
  assert.equal(await runUpgrade(['--repo', 'not-a-repo'], { out: bad, err: bad }), 2);
  assert.match(bad.text(), /not a folder or a GitHub repo/);
  const missing = sink();
  assert.equal(await runUpgrade(['--repo', 'acme/gone'], { out: missing, err: missing, seams: { kit: k.kit, cloneUrlOf: () => new URL('file:///definitely/not/here.git').href } }), 2);
  assert.match(missing.text(), /could not clone acme\/gone/);
});

test('a red gate in the temporary clone keeps it and prints its path', async () => {
  const k = kitRepo();
  const o = v2Origin();
  const cloneUrlOf = urls({ 'acme/notes': o.bare });
  const { code, report } = await upgrade({ repo: '.', remote: 'acme/notes', cloneUrlOf, kit: k.kit, gateOf: () => [{ name: 'plan-check', ok: false, out: 'no' }], today: '2026-10-27' });
  assert.equal(code, 1);
  assert.ok(report.worktree && fs.existsSync(report.worktree), 'the clone is kept');
  assert.match(render(report), /worktree kept: /);
  scratch.push(report.worktree);
});

// ---- --pr -----------------------------------------------------------------------------------------------------------

const RESOLVED = '# clash\n\nstep: run the gate twice, then land\n\nend\n';
const stubAssist = () => async () => ({ text: RESOLVED, reasons: ['hunk 1: kept "twice", the repo runs its gate twice'] });

/** A stubbed gh holding the pull requests in memory: every call is recorded in `calls`. */
function ghStub({ perm = 'WRITE', login = 'me', owner = 'acme', fail = {} } = {}) {
  const prs = [];
  const calls = [];
  const comments = [];
  const forks = [];
  const ok = (stdout = '') => ({ ok: true, stdout, stderr: '' });
  const no = (stderr) => ({ ok: false, stdout: '', stderr });
  const arg = (args, flag) => args[args.indexOf(flag) + 1];
  const fn = async (args) => {
    calls.push(args);
    const key = args.slice(0, 2).join(' ');
    if (fail[key]) return no(fail[key]);
    if (key === 'repo view') return ok(JSON.stringify({ viewerPermission: perm }));
    if (key === 'api user') return ok(`${login}\n`);
    if (key === 'repo fork') { forks.push(args[2]); return ok(''); }
    if (key === 'pr list') return ok(JSON.stringify(prs.map((p) => ({ number: p.number, url: p.url, headRefName: p.branch, headRepositoryOwner: { login: p.owner } }))));
    if (key === 'pr create') {
      const head = arg(args, '--head');
      const [who, branch] = head.includes(':') ? head.split(':') : [owner, head];
      const p = { number: prs.length + 1, url: `https://github.com/${arg(args, '--repo')}/pull/${prs.length + 1}`, branch, owner: who, head, base: arg(args, '--base'), title: arg(args, '--title'), body: fs.readFileSync(arg(args, '--body-file'), 'utf8') };
      prs.push(p);
      return ok(`${p.url}\n`);
    }
    if (key === 'pr edit') { prs.find((p) => String(p.number) === args[2]).body = fs.readFileSync(arg(args, '--body-file'), 'utf8'); return ok(''); }
    if (key === 'pr comment') { comments.push({ number: Number(args[2]), body: fs.readFileSync(arg(args, '--body-file'), 'utf8') }); return ok(''); }
    return no(`the stub has no answer for gh ${args.join(' ')}`);
  };
  return Object.assign(fn, { prs, calls, comments, forks, with: (k) => calls.filter((c) => c.slice(0, 2).join(' ') === k) });
}
const BRANCH = syncBranch('2.1.0');
const run = (kit, extra = {}) => upgrade({ repo: '.', remote: 'acme/notes', pr: true, kit, assist: stubAssist(), today: '2026-10-27', sleep: async () => {}, ...extra });
const heads = (bare) => git(bare, 'for-each-ref', '--format=%(refname:short)', 'refs/heads');
const moveMain = (o, text) => { put(o.seed, 'NOTES.md', text); commit(o.seed, 'docs: notes'); git(o.seed, 'push', '-q', 'origin', 'main'); };

test('--pr with push access: a pushed nexus/upgrade-<version> branch and a pull request whose body is the report', async () => {
  const k = kitRepo();
  const o = v2Origin();
  const gh = ghStub();
  const before = clones();
  const main = git(o.bare, 'rev-parse', 'main');
  const { code, report } = await run(k.kit, { cloneUrlOf: urls({ 'acme/notes': o.bare }), gh });
  assert.equal(code, 0, JSON.stringify(report, null, 2));
  assert.deepEqual(clones(), before, 'the temporary clone is removed');
  assert.equal(git(o.bare, 'rev-parse', 'main'), main, 'the default branch is never pushed');
  assert.equal(git(o.bare, 'log', '--format=%s', `main..${BRANCH}`), syncSubject('2.1.0'), 'one sync commit on the branch');
  assert.equal(`${git(o.bare, 'show', `${BRANCH}:skills/keep.md`)}\n`, THEIRS['skills/keep.md']);
  assert.equal(`${git(o.bare, 'show', `${BRANCH}:skills/clash.md`)}\n`, RESOLVED);
  assert.deepEqual(gh.with('repo fork'), [], 'push access: no fork');
  assert.equal(gh.prs.length, 1);
  const pr = gh.prs[0];
  assert.deepEqual([pr.head, pr.base, pr.title], [BRANCH, 'main', syncSubject('2.1.0')]);
  assert.deepEqual(report.pr, { branch: BRANCH, head: BRANCH, fork: false, number: 1, url: 'https://github.com/acme/notes/pull/1', action: 'opened' });
  // The body carries the report: the per-file table, new content, the assisted merge's diff with its reason, the knobs
  // written, the gate and the predicted first tick.
  for (const want of ['| status | path | note |', '| replaced | `skills/keep.md` |', '| added | `skills/fresh.md` | new kit content |', '### New kit content (1)', '- `skills/fresh.md` (skill)',
    '### Assisted merge: `skills/clash.md`', '- kept from ours: hunk 1: kept "twice"', '+step: run the gate twice, then land', '### Knobs written', '`stall_action`: alert', '- green: plan-check']) {
    assert.ok(pr.body.includes(want), `${want}\n---\n${pr.body}`);
  }
  assert.match(render(report), new RegExp(`pull request opened: https://github.com/acme/notes/pull/1  \\(branch ${BRANCH.replace(/[.+]/g, '\\$&')}\\)`));
  assert.equal(report.worktree, null);
});

test('a second run updates the open pull request in place: the branch force-updated, a comment, never a second pull request', async () => {
  const k = kitRepo();
  const o = v2Origin();
  const gh = ghStub();
  const cloneUrlOf = urls({ 'acme/notes': o.bare });
  const first = await run(k.kit, { cloneUrlOf, gh });
  assert.equal(first.report.pr.action, 'opened');
  const tip = git(o.bare, 'rev-parse', BRANCH);

  // Nothing changed: no push, no edit, no comment, no second pull request.
  const same = await run(k.kit, { cloneUrlOf, gh });
  assert.equal(same.code, 0, JSON.stringify(same.report.error));
  assert.equal(same.report.pr.action, 'unchanged');
  assert.equal(git(o.bare, 'rev-parse', BRANCH), tip);
  assert.deepEqual([gh.prs.length, gh.with('pr create').length, gh.with('pr edit').length, gh.comments.length], [1, 1, 0, 0]);

  // The repo moved on: the result differs, so the same branch is force-updated and the same pull request edited.
  moveMain(o, 'a new file on main\n');
  const again = await run(k.kit, { cloneUrlOf, gh });
  assert.equal(again.code, 0, JSON.stringify(again.report.error));
  assert.equal(again.report.pr.action, 'updated');
  assert.equal(again.report.pr.number, 1);
  assert.notEqual(git(o.bare, 'rev-parse', BRANCH), tip, 'the branch moved');
  assert.equal(git(o.bare, 'log', '--format=%s', `main..${BRANCH}`), syncSubject('2.1.0'), 'still one sync commit, on the new main');
  assert.equal(git(o.bare, 'show', `${BRANCH}:NOTES.md`), 'a new file on main');
  assert.deepEqual([gh.prs.length, gh.with('pr create').length, gh.with('pr edit').length, gh.comments.length], [1, 1, 1, 1]);
  assert.equal(gh.comments[0].number, 1);
  assert.match(gh.comments[0].body, /A new run updated this branch/);
  assert.match(gh.comments[0].body, /Changed since the last run/);
  assert.match(gh.comments[0].body, /NOTES\.md/, 'what changed');
});

test('without push access it forks and opens the pull request from the fork; a rerun updates that one', async () => {
  const k = kitRepo();
  const o = v2Origin();
  const fork = bareRepo('nexus-rem-fork-');
  const gh = ghStub({ perm: 'READ', login: 'me' });
  const cloneUrlOf = urls({ 'acme/notes': o.bare });
  const forkUrlOf = urls({ 'me/notes': fork });
  const first = await run(k.kit, { cloneUrlOf, forkUrlOf, gh });
  assert.equal(first.code, 0, JSON.stringify(first.report, null, 2));
  assert.deepEqual(gh.forks, ['acme/notes']);
  assert.equal(heads(o.bare), 'main', 'nothing is pushed to the repo itself');
  assert.equal(git(fork, 'log', '--format=%s', '-1', BRANCH), syncSubject('2.1.0'), 'the branch is on the fork');
  assert.equal(gh.prs[0].head, `me:${BRANCH}`);
  assert.equal(gh.prs[0].base, 'main');
  assert.equal(first.report.pr.fork, true);
  assert.match(render(first.report), /from your fork as me:/);
  const tip = git(fork, 'rev-parse', BRANCH);
  moveMain(o, 'moved\n');
  const again = await run(k.kit, { cloneUrlOf, forkUrlOf, gh });
  assert.equal(again.report.pr.action, 'updated', JSON.stringify(again.report.error));
  assert.notEqual(git(fork, 'rev-parse', BRANCH), tip);
  assert.deepEqual([gh.prs.length, gh.comments.length], [1, 1]);
  assert.equal(heads(o.bare), 'main');
});

test('a branch holding anyone\'s own commit is never overwritten; nothing is pushed and no pull request opens', async () => {
  const k = kitRepo();
  const o = v2Origin();
  git(o.seed, 'switch', '-q', '-c', BRANCH);
  put(o.seed, 'mine.md', 'hand work\n');
  commit(o.seed, 'docs: my own note');
  git(o.seed, 'push', '-q', 'origin', BRANCH);
  const mine = git(o.bare, 'rev-parse', BRANCH);
  const gh = ghStub();
  const { code, report } = await run(k.kit, { cloneUrlOf: urls({ 'acme/notes': o.bare }), gh });
  assert.equal(code, 1);
  assert.match(report.error, /already exists on acme\/notes with commits that are not an upgrade's \(docs: my own note\).*Nothing was pushed/);
  assert.equal(git(o.bare, 'rev-parse', BRANCH), mine, 'the branch is as it was');
  assert.equal(gh.prs.length, 0);
  assert.ok(report.worktree && fs.existsSync(report.worktree), 'the clone is kept');
  scratch.push(report.worktree);
});

test('a red gate opens nothing: no branch, no gh call, the clone kept and its path printed', async () => {
  const k = kitRepo();
  const o = v2Origin();
  const gh = ghStub();
  const { code, report } = await run(k.kit, { cloneUrlOf: urls({ 'acme/notes': o.bare }), gh, gateOf: () => [{ name: 'plan-check', ok: false, out: 'no' }] });
  assert.equal(code, 1);
  assert.equal(heads(o.bare), 'main', 'nothing pushed');
  assert.equal(gh.calls.length, 0, 'gh is never called');
  assert.equal(report.pr, undefined);
  assert.ok(report.worktree && fs.existsSync(report.worktree));
  assert.match(render(report), /worktree kept: /);
  scratch.push(report.worktree);
});

test('gh failing (signed out, cannot fork, cannot open) stops with its reason, keeps the clone and opens nothing', async () => {
  const k = kitRepo();
  for (const [fail, perm, want] of [
    [{ 'repo view': 'not logged in' }, 'WRITE', /gh could not read acme\/notes.*not logged in/],
    [{ 'repo fork': 'forbidden' }, 'READ', /gh could not fork acme\/notes: forbidden/],
    [{ 'pr create': 'validation failed' }, 'WRITE', /gh could not open the pull request: validation failed/],
  ]) {
    const o = v2Origin();
    const gh = ghStub({ fail, perm });
    const { code, report } = await run(k.kit, { cloneUrlOf: urls({ 'acme/notes': o.bare }), forkUrlOf: urls({ 'me/notes': bareRepo('nexus-rem-fork-') }), gh });
    assert.equal(code, 1);
    assert.match(report.error, want);
    assert.equal(gh.prs.length, 0);
    assert.ok(report.worktree && fs.existsSync(report.worktree), 'kept');
    scratch.push(report.worktree);
  }
});

test('--pr on a local --repo pushes to that repo\'s origin; with no GitHub origin it says so', async () => {
  const k = kitRepo();
  const o = v2Origin();
  const gh = ghStub();
  const { code, report } = await upgrade({ repo: o.local, pr: true, slug: 'acme/notes', gh, kit: k.kit, assist: stubAssist(), today: '2026-10-27' });
  assert.equal(code, 0, JSON.stringify(report.error));
  assert.equal(git(o.bare, 'log', '--format=%s', `main..${BRANCH}`), syncSubject('2.1.0'));
  assert.equal(report.pr.action, 'opened');
  const none = await upgrade({ repo: o.local, pr: true, gh, kit: k.kit, today: '2026-10-27' });
  assert.equal(none.code, 2);
  assert.match(none.report.error, /--pr needs a GitHub repo/);
});

test('runUpgrade: --repo owner/name --pr prints the pull request; --pr is no longer refused', async () => {
  const k = kitRepo();
  const o = v2Origin();
  const gh = ghStub();
  const seams = { kit: k.kit, gh, cloneUrlOf: urls({ 'acme/notes': o.bare }), sleep: async () => {} };
  const out = sink();
  const code = await runUpgrade(['--repo', 'acme/notes', '--pr'], { out, err: out, today: '2026-10-27', assistOf: () => stubAssist(), seams });
  assert.equal(code, 0, out.text());
  assert.match(out.text(), /committed [0-9a-f]{7} plan: sync to nexus 2\.1\.0 on /);
  assert.match(out.text(), /pull request opened: https:\/\/github\.com\/acme\/notes\/pull\/1/);
  const json = sink();
  const again = await runUpgrade(['--repo', 'acme/notes', '--pr', '--json'], { out: json, err: json, today: '2026-10-27', assistOf: () => stubAssist(), seams });
  assert.equal(again, 0);
  assert.equal(JSON.parse(json.text()).pr.action, 'unchanged');
});

test('the pull request body: the predicted first tick, a diff holding backticks, a body kept under the size limit', () => {
  const report = {
    repo: 'acme/notes', origin: { url: 'u', branch: 'main', sha: 'a'.repeat(40) }, files: [{ path: 'a|b.md', status: 'added', note: 'x' }], archive: ['2026-01-01 · 1 · x'], warnings: ['w1'],
    gate: [{ name: 'plan-check', ok: true }], knobs: [], merges: [{ path: 'x.md', kind: 'assisted', applied: true, reasons: ['why'], diff: '-a\n+```b```' }],
    dispatch: { text: 'lane snapshot', pr: { text: '/next 1.1 (asap)', idle: false } },
  };
  const body = renderPrBody(report);
  assert.ok(body.includes('### Predicted first tick\n\n- until `NEXUS_LOOP_MODE=owner` is set (pr mode): /next 1.1 (asap)\n- owner mode: lane snapshot'), body);
  assert.ok(body.includes('`a\\|b.md`'), 'a pipe in a path does not break the table');
  assert.ok(body.includes('\n````diff\n-a\n+```b```\n````\n'), 'a longer fence than the diff holds');
  assert.ok(body.includes('### Archive (+1 line)'));
  const big = renderPrBody({ ...report, merges: [{ path: 'big.md', kind: 'conflict', applied: false, diff: 'x'.repeat(70000) }] });
  assert.ok(big.length < 61000 && /truncated/.test(big));
});

test('--pr on a v1 repo: the conversion is one commit on nexus/upgrade-v2 and the pull request body is the v1 report', async () => {
  const bare = bareRepo('nexus-rem-v1o-');
  const seed = tmp('nexus-rem-v1s-');
  git(seed, 'init', '-q', '-b', 'main');
  git(seed, 'remote', 'add', 'origin', bare);
  put(seed, 'package.json', '{ "name": "@acme/notes" }\n');
  put(seed, 'plan/steps/01_build_plan.md', '# 01 — Build plan\n\n## Status (at-a-glance)\n\n- [x] Phase 1 — Start (commit abc1234)\n- [ ] Phase 2 — Search\n\n## Carry-overs / known gaps\n\n(None.)\n\n## Phase log (commit hashes)\n\n');
  put(seed, 'plan/phases/phase_2_search.md', '# Phase 2 — Search\n\n## Scope\n\nA query finds a note.\n');
  commit(seed, 'v1');
  git(seed, 'push', '-q', 'origin', 'main');
  const gh = ghStub();
  const main = git(bare, 'rev-parse', 'main');
  const { code, report } = await upgrade({ repo: '.', remote: 'acme/notes', pr: true, cloneUrlOf: urls({ 'acme/notes': bare }), gh, today: '2026-10-27', sleep: async () => {} });
  assert.equal(code, 0, JSON.stringify(report.error || report.gate, null, 2));
  assert.equal(git(bare, 'rev-parse', 'main'), main);
  assert.equal(git(bare, 'log', '--format=%s', 'main..nexus/upgrade-v2'), COMMIT_SUBJECT);
  assert.equal(report.shape, 'v1');
  assert.equal(report.pr.action, 'opened');
  assert.deepEqual([gh.prs[0].head, gh.prs[0].title], ['nexus/upgrade-v2', COMMIT_SUBJECT]);
  for (const want of ['moves the repo from nexus v1', '### Files (', '### Archive (+', '### Gate', '### Predicted first tick']) assert.ok(gh.prs[0].body.includes(want), `${want}\n${gh.prs[0].body}`);
  const again = await upgrade({ repo: '.', remote: 'acme/notes', pr: true, cloneUrlOf: urls({ 'acme/notes': bare }), gh, today: '2026-10-27', sleep: async () => {} });
  assert.equal(again.report.pr.action, 'unchanged');
  assert.equal(gh.prs.length, 1);
});

test('the report is defused before it is a pull request body: no ping, no cross-reference, no closing keyword', () => {
  assert.ok(!/@[A-Za-z]/.test(defuse('thanks @octocat')));
  assert.ok(!/#\d/.test(defuse('see #12 and acme/notes#3')));
  const closing = defuse('fixes #12, Closes acme/notes#3, resolved https://github.com/a/b/issues/9');
  assert.ok(!/\b(fixes|closes|resolved)\s*:?\s+(#|[\w.-]+\/[\w.-]+#|https)/i.test(closing), closing);
  assert.equal(defuse('plain text'), 'plain text');
  const body = renderPrBody({
    repo: 'acme/notes', origin: { branch: 'main', sha: 'abcdef1234' }, files: [{ status: 'added', path: 'a.md', note: 'cc @octocat fixes #12' }],
    warnings: ['ping @octocat, this fixes #12'], gate: [{ name: 'plan-check', ok: true }], archive: [], knobs: [],
    dispatch: { text: 'lane x, closes #4' },
  });
  assert.ok(!/@[A-Za-z]/.test(body.replace(/`[^`]*`/g, '')), body);
  assert.ok(!/#\d/.test(body), body);
});

test('a large report keeps the gate and warnings first, caps each section, and cuts only between sections', () => {
  const many = (n) => Array.from({ length: n }, (_, i) => `line ${i} ${'x'.repeat(80)}`);
  const body = renderPrBody({
    repo: 'acme/notes', origin: { branch: 'main', sha: 'abcdef1234' }, sync: { from: 'a', to: { version: '2.1.0', ref: 'b'.repeat(40) } },
    files: many(2000).map((s, i) => ({ status: 'replaced', path: `f${i}`, note: 'kit text' })),
    warnings: ['w1', 'w2'], gate: [{ name: 'plan-check', ok: true }, { name: 'workflow-lint', ok: false }],
    merges: [{ kind: 'assisted', path: 'skills/a.md', applied: true, reasons: ['r'], diff: many(2000).join('\n') }],
    archive: many(2000), knobs: [], added: [],
  });
  assert.ok(body.length <= 60000, body.length);
  assert.ok(body.indexOf('### Gate') < body.indexOf('### Warnings') && body.indexOf('### Warnings') < body.indexOf('### Files'));
  assert.ok(body.includes('- RED: workflow-lint'), 'the gate survives');
  assert.equal((body.match(/^```/gm) || []).length % 2, 0, 'every fence is closed');
  assert.equal((body.match(/<details>/g) || []).length, (body.match(/<\/details>/g) || []).length);
  assert.match(body, /\.\.\. and 1800 more files/);
  assert.match(body, /\(\d+ more lines\)/);
  assert.ok(body.endsWith('Running it again updates this pull request in place.'));
});

test('--repo acme/notes falls back to the slug when a folder of that name is not a git repo, and warns when it is one', async () => {
  const k = kitRepo();
  const o = v2Origin();
  const cwd = tmp('nexus-slug-cwd-');
  fs.mkdirSync(path.join(cwd, 'acme', 'notes'), { recursive: true });
  const out = sink();
  const err = sink();
  const seams = { kit: k.kit, cloneUrlOf: urls({ 'acme/notes': o.bare }), sleep: async () => {} };
  const code = await runUpgrade(['--repo', 'acme/notes', '--json'], { cwd, out, err, assistOf: () => null, today: '2026-10-27', seams });
  assert.notEqual(code, 2, `${out.text()}\n${err.text()}`);
  assert.match(out.text(), /"origin"[\s\S]*acme\/notes|"url"/);
  assert.equal(err.text(), '');
  git(path.join(cwd, 'acme', 'notes'), 'init', '-q', '-b', 'main');
  const e2 = sink();
  await runUpgrade(['--repo', 'acme/notes', '--json'], { cwd, out: sink(), err: e2, assistOf: () => null, today: '2026-10-27', seams });
  assert.match(e2.text(), /is both a folder here and a GitHub repo; using the folder/);
});

test('the open pull request is looked up by its head branch', async () => {
  const k = kitRepo();
  const o = v2Origin();
  const gh = ghStub();
  await run(k.kit, { cloneUrlOf: urls({ 'acme/notes': o.bare }), gh });
  const list = gh.with('pr list')[0];
  assert.equal(list[list.indexOf('--head') + 1], BRANCH);
});

test('a blobless clone carries core.longpaths in its own config', () => {
  const o = v2Origin();
  const c = cloneBlobless('acme/notes', { cloneUrl: () => o.bare });
  try { assert.equal(git(c.dir, 'config', '--local', '--get', 'core.longpaths'), 'true'); } finally { c.remove(); }
});
