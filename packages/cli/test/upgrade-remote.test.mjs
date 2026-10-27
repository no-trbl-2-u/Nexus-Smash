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
import { upgrade, render, runUpgrade } from '../server/upgrade.mjs';
import { parseRepo, slugOfUrl, cloneBlobless, cloneUrlOf as githubUrl } from '../server/upgrade-remote.mjs';
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

const BASE = { 'skills/keep.md': '# keep\n\nThe kit\'s step.\n', 'skills/custom.md': '# custom\n\nkit one\n\nkit two\n\nkit three\n' };
const THEIRS = { 'skills/keep.md': '# keep\n\nThe kit\'s step, revised.\n', 'skills/custom.md': '# custom\n\nkit one, revised\n\nkit two\n\nkit three\n', 'skills/fresh.md': '# fresh\n\nNew in the kit.\n' };
const OURS = { 'skills/keep.md': BASE['skills/keep.md'], 'skills/custom.md': '# custom\n\nkit one\n\nkit two\n\nour three\n' };
const LIST = ['skills/keep.md', 'skills/custom.md', 'skills/fresh.md'].map((r) => ({ kit: `templates/${r}`, repo: r, kind: 'skill' }));
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
