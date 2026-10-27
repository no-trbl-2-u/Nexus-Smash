// `nexus upgrade --repo owner/name` and `--pr` (spec 58, "Remote: a pull request without a checkout").
//
// A GitHub repo is cloned blobless into a temporary folder (no local checkout is needed or touched) and goes through
// the same path as a local run: detect, convert or sync, gate, report. With --pr the result is committed on
// `nexus/upgrade-<version>`, pushed, and a pull request is opened whose body is the report. Without push access the
// branch goes to a fork (`gh repo fork`) and the pull request is opened from it. An open upgrade pull request from an
// earlier run is updated in place (its branch force-updated, a comment saying what changed), never a second one. The
// branch is replaced only when it holds this command's own commits alone (the sync's rule, upgrade-sync.mjs
// canCommit): someone's work on it is never overwritten. The gate has already run in the clone before anything here
// (a red gate never reaches this file), so nothing is pushed or opened on red.
//
// Every outside call goes through a seam: `gh` is an async (args, { input }) => { ok, stdout, stderr }, and the
// clone and fork URLs come from `cloneUrlOf(owner/name)` / `forkUrlOf(owner/name)`, so tests run a stubbed gh over
// local bare remotes and never reach GitHub.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gitIn, redactUrl } from './upgrade.mjs';

const SLUG = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/;
const GITHUB = /^(?:https?:\/\/(?:[^@/\s]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/|github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/;
/** The sync's and the converter's own subjects: a branch holding only these is this command's to replace. */
export const OWN_SUBJECTS = Object.freeze(['plan: sync to nexus ', 'plan: upgrade to nexus v2']);
const PUSH_ROLES = ['ADMIN', 'MAINTAIN', 'WRITE'];
const BODY_MAX = 60000;

/** `owner/name` or a GitHub URL as { slug, owner, name }, else null. */
export function parseRepo(arg) {
  const s = String(arg ?? '').trim();
  const m = GITHUB.exec(s) || SLUG.exec(s);
  return m ? { slug: `${m[1]}/${m[2]}`, owner: m[1], name: m[2] } : null;
}

/** The GitHub slug of a git remote URL (the local repo's origin), or null for any other host. */
export function slugOfUrl(url) {
  const m = GITHUB.exec(String(url ?? '').trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

export const cloneUrlOf = (slug) => `https://github.com/${slug}.git`;

/** The real gh, never through a shell (a title has spaces): async (args, { input, cwd }) => { ok, stdout, stderr }. */
export function realGh(args, { input, cwd, timeout = 120000 } = {}) {
  return new Promise((resolve) => {
    let child;
    try { child = spawn('gh', args, { cwd, windowsHide: true }); } catch (e) { return resolve({ ok: false, stdout: '', stderr: String(e.message || e) }); }
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill(); stderr += `\ntimed out after ${timeout} ms`; }, timeout);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, stdout, stderr: String(e.message || e) }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, stdout, stderr }); });
    child.stdin.end(input ?? '');
  });
}

/**
 * A blobless clone of `slug` into a temporary folder, shaped like upgrade.mjs freshWorktree:
 * { dir, url, branch, sha, remove() }. Throws (code 2) with a reason when the clone fails.
 */
export function cloneBlobless(slug, { cloneUrl = cloneUrlOf } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-upgrade-clone-'));
  const hooks = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-upgrade-hooks-'));
  const url = cloneUrl(slug);
  const got = gitIn(dir, ['-c', `core.hooksPath=${hooks}`, 'clone', '--quiet', '--filter=blob:none', url, '.']);
  fs.rmSync(hooks, { recursive: true, force: true });
  if (!got.ok) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw Object.assign(new Error(`could not clone ${slug}: ${redactUrl(got.err)}`), { code: 2 });
  }
  const branch = gitIn(dir, ['symbolic-ref', '--short', 'HEAD']);
  const sha = gitIn(dir, ['rev-parse', 'HEAD']);
  if (!branch.ok || !sha.ok) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw Object.assign(new Error(`${slug} has no commits to upgrade`), { code: 2 });
  }
  return { dir, url: redactUrl(url), branch: branch.out, sha: sha.out, remove: () => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) };
}

/** Can the commit be made in `dir`? Null, or why not (no git identity). */
export function identityProblem(dir) {
  return gitIn(dir, ['var', 'GIT_AUTHOR_IDENT']).ok && gitIn(dir, ['var', 'GIT_COMMITTER_IDENT']).ok ? null
    : 'no git identity for the upgrade commit: set user.name and user.email (git config --global user.name "<name>"; git config --global user.email "<email>") and run again';
}

/**
 * Commit the v1 conversion in `dir` (a v1 path leaves its result in the tree): one commit on `branch`, no repo
 * hook. { sha, branch, subject } or { empty: true } when the tree did not change, or { error }.
 */
export function commitTree(dir, { branch, subject, body = '' }) {
  const bad = identityProblem(dir);
  if (bad) return { error: bad };
  const sw = gitIn(dir, ['switch', '-q', '-C', branch]);
  if (!sw.ok) return { error: `git switch ${branch} failed: ${sw.err}` };
  const add = gitIn(dir, ['add', '-A']);
  if (!add.ok) return { error: `git add failed: ${add.err}` };
  if (!gitIn(dir, ['status', '--porcelain']).out) return { empty: true };
  const hooks = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-upgrade-hooks-'));
  const done = gitIn(dir, ['-c', `core.hooksPath=${hooks}`, 'commit', '-q', '-m', subject, ...(body ? ['-m', body] : [])]);
  fs.rmSync(hooks, { recursive: true, force: true });
  if (!done.ok) return { error: `the upgrade commit failed: ${done.err || 'git refused'}` };
  return { sha: gitIn(dir, ['rev-parse', 'HEAD']).out, branch, subject };
}

const fence = (text, lang = '') => {
  const longest = Math.max(2, ...[...String(text).matchAll(/`+/g)].map((m) => m[0].length));
  const f = '`'.repeat(longest + 1);
  return `${f}${lang}\n${text}\n${f}`;
};
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/** The report as the pull request's body (markdown): the same content the terminal prints. */
export function renderPrBody(report) {
  const out = [];
  const s = report.sync;
  out.push(s ? `This pull request syncs the repo to nexus ${s.to.version}: \`${s.from}\` to \`${s.to.ref.slice(0, 12)}\`.`
    : `This pull request moves the repo from nexus v1 (a phase plan) to v2 (specs and chunks).`);
  if (report.origin) out.push('', `Made from \`${report.origin.branch}\` @ \`${report.origin.sha.slice(0, 7)}\` of \`${report.repo}\`, in a temporary clone; the gate below ran there before this branch was pushed.`);
  out.push('', `### Files (${report.files.length})`, '', '| status | path | note |', '|---|---|---|');
  for (const f of report.files) out.push(`| ${cell(f.status)} | \`${cell(f.path)}\` | ${cell(f.note)} |`);
  if (report.added?.length) {
    out.push('', `### New kit content (${report.added.length})`, '');
    for (const a of report.added) out.push(`- \`${a.path}\` (${a.kind})`);
  }
  for (const m of report.merges || []) {
    out.push('', `### ${m.kind === 'assisted' ? 'Assisted merge' : m.kind === 'conflict' ? 'Conflict' : 'Merged'}: \`${m.path}\`${m.applied ? '' : ' (left as ours)'}`, '');
    for (const r of m.reasons || []) out.push(`- kept from ours: ${r}`);
    if (m.diff) out.push('', fence(m.diff, 'diff'));
  }
  if (report.archive?.length) {
    out.push('', `### Archive (+${report.archive.length} line${report.archive.length === 1 ? '' : 's'})`, '', '<details><summary>archive lines</summary>', '', fence(report.archive.map((l) => `+ ${l}`).join('\n')), '', '</details>');
  }
  if (report.workflow) {
    const k = report.workflow.kept;
    out.push('', '### Workflow', '', `- cron: ${k.cron.length ? k.cron.join(', ') : '(none: dispatch only)'}`, `- ceiling: ${k.ceiling ?? "the kit's"}`, `- model: ${k.model ?? "the kit's"}`);
  }
  if (report.knobs?.length) {
    const written = report.knobs.filter((k) => k.at !== 'var' && k.status === 'written');
    out.push('', '### Knobs written (conservative: behaviour does not change until each is turned up)', '');
    for (const k of written) out.push(`- \`${k.at === 'section' ? `## ${k.knob}` : k.knob}\`: ${k.value}`);
    if (!written.length) out.push('- none written');
  }
  out.push('', `### Warnings (${report.warnings?.length || 0})`, '');
  for (const w of report.warnings || []) out.push(`- ${w}`);
  out.push('', '### Gate', '');
  for (const g of report.gate || []) out.push(`- ${g.ok ? 'green' : 'RED'}: ${g.name}`);
  if (report.dispatch) {
    out.push('', '### Predicted first tick', '');
    if (report.dispatch.pr) {
      out.push(`- until \`NEXUS_LOOP_MODE=owner\` is set (pr mode): ${report.dispatch.pr.text}`, `- owner mode: ${report.dispatch.text}`);
    } else out.push(`- ${report.dispatch.text}`);
  }
  out.push('', '---', 'Opened by `nexus upgrade --pr`. Running it again updates this pull request in place.');
  const text = out.join('\n');
  return text.length <= BODY_MAX ? text : `${text.slice(0, BODY_MAX)}\n\n(truncated: the full report is what \`nexus upgrade --repo <owner/name>\` prints)`;
}

const ownCommits = (subjects) => subjects.filter((s) => !OWN_SUBJECTS.some((p) => s.startsWith(p)));

/**
 * The remote branch at `target`: { sha, foreign: [subjects], tree } or null when absent. Fetches the tip so its commits
 * can be read; foreign are the subjects, since `base`, that are not this command's own.
 */
function remoteBranch(dir, target, branch, base) {
  const ls = gitIn(dir, ['ls-remote', target, `refs/heads/${branch}`]);
  if (!ls.ok) return { error: `could not read ${branch} on ${redactUrl(target)}: ${redactUrl(ls.err)}` };
  const sha = ls.out.split(/\s+/)[0];
  if (!sha) return null;
  const got = gitIn(dir, ['fetch', '--quiet', '--no-tags', target, `refs/heads/${branch}`]);
  if (!got.ok) return { error: `could not fetch ${branch} from ${redactUrl(target)}: ${redactUrl(got.err)}` };
  const log = gitIn(dir, ['log', '--format=%s', `${base}..${sha}`]);
  const tree = gitIn(dir, ['rev-parse', `${sha}^{tree}`]);
  return { sha, foreign: log.ok ? ownCommits(log.out.split(/\r?\n/).filter(Boolean)) : ['(unreadable)'], tree: tree.out };
}

const tmpFile = (text) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-upgrade-pr-'));
  const f = path.join(d, 'body.md');
  fs.writeFileSync(f, text);
  return { f, done: () => fs.rmSync(d, { recursive: true, force: true }) };
};

/**
 * Push the commit at HEAD of `dir` (on `branch`) and open or update the pull request. Returns
 * { pr: { url, number, action: 'opened' | 'updated' | 'unchanged', branch, head, fork } } or { error }.
 *   slug      the GitHub repo the pull request is for (owner/name)
 *   base      the repo's default branch, the pull request's base; baseSha its commit in the clone
 *   gh        the gh seam; forkUrlOf(slug) the fork's git URL; sleep(ms) the pause between fork push tries
 *   remote    'origin' when the clone's origin is the repo (write access pushes there)
 */
export async function openPullRequest({ dir, slug, branch, base, baseSha, title, body, gh = realGh, forkUrlOf = cloneUrlOf, remote = 'origin', sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const [owner, name] = slug.split('/');
  const view = await gh(['repo', 'view', slug, '--json', 'viewerPermission'], { cwd: dir });
  if (!view.ok) return { error: `gh could not read ${slug} (is gh signed in?): ${(view.stderr || view.stdout).trim()}` };
  let perm = null;
  try { perm = String(JSON.parse(view.stdout).viewerPermission || '').toUpperCase(); } catch { /* unread */ }
  const direct = PUSH_ROLES.includes(perm);
  let target = remote;
  let login = null;
  let head = branch;
  if (!direct) {
    // No push access: fork, and open the pull request from the fork.
    const who = await gh(['api', 'user', '--jq', '.login'], { cwd: dir });
    login = who.ok ? who.stdout.trim() : '';
    if (!login) return { error: `gh could not tell who is signed in, so there is no fork to push to: ${(who.stderr || '').trim()}` };
    const fork = await gh(['repo', 'fork', slug, '--clone=false'], { cwd: dir });
    if (!fork.ok) return { error: `gh could not fork ${slug}: ${(fork.stderr || fork.stdout).trim()}` };
    target = forkUrlOf(`${login}/${name}`);
    head = `${login}:${branch}`;
  }
  const prior = remoteBranch(dir, target, branch, baseSha);
  if (prior?.error) return { error: prior.error };
  if (prior?.foreign.length) {
    return { error: `${branch} already exists on ${direct ? slug : `the fork ${login}/${name}`} with commits that are not an upgrade's (${prior.foreign[0]}); merge or delete that branch, then run again. Nothing was pushed.` };
  }
  const tree = gitIn(dir, ['rev-parse', 'HEAD^{tree}']).out;
  const unchanged = !!prior && prior.tree === tree;
  if (!unchanged) {
    const hooks = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-upgrade-hooks-'));
    const lease = `--force-with-lease=refs/heads/${branch}:${prior ? prior.sha : ''}`;
    let pushed = null;
    for (let i = 0; i < (direct ? 1 : 4); i++) {
      if (i) await sleep(2000 * i); // a new fork is not always ready the moment gh returns
      pushed = gitIn(dir, ['-c', `core.hooksPath=${hooks}`, 'push', '--quiet', lease, target, `HEAD:refs/heads/${branch}`]);
      if (pushed.ok) break;
    }
    fs.rmSync(hooks, { recursive: true, force: true });
    if (!pushed.ok) return { error: `git push of ${branch} failed: ${redactUrl(pushed.err)}` };
  }
  const found = await gh(['pr', 'list', '--repo', slug, '--state', 'open', '--limit', '100', '--json', 'number,url,headRefName,headRepositoryOwner'], { cwd: dir });
  if (!found.ok) return { error: `gh could not list pull requests on ${slug}: ${(found.stderr || found.stdout).trim()}` };
  let open = [];
  try { open = JSON.parse(found.stdout || '[]'); } catch { /* none */ }
  const headOwner = login || owner;
  const have = open.find((p) => p.headRefName === branch && String(p.headRepositoryOwner?.login ?? headOwner).toLowerCase() === headOwner.toLowerCase());
  const pr = { branch, head, fork: !direct };
  if (have) {
    if (unchanged) return { pr: { ...pr, number: have.number, url: have.url, action: 'unchanged' } };
    const changed = gitIn(dir, ['diff', '--name-status', prior.sha, 'HEAD']);
    const now = gitIn(dir, ['rev-parse', '--short', 'HEAD']).out;
    const note = [`A new run updated this branch: \`${prior.sha.slice(0, 7)}\` to \`${now}\`.`, '', 'Changed since the last run:', '', fence(changed.ok && changed.out ? changed.out : '(names unavailable)'), '', 'The description above is the new report.'].join('\n');
    const b = tmpFile(body);
    const c = tmpFile(note);
    try {
      const edit = await gh(['pr', 'edit', String(have.number), '--repo', slug, '--body-file', b.f], { cwd: dir });
      if (!edit.ok) return { error: `gh could not update pull request #${have.number}: ${(edit.stderr || edit.stdout).trim()}` };
      const say = await gh(['pr', 'comment', String(have.number), '--repo', slug, '--body-file', c.f], { cwd: dir });
      if (!say.ok) return { error: `gh could not comment on pull request #${have.number}: ${(say.stderr || say.stdout).trim()}` };
    } finally { b.done(); c.done(); }
    return { pr: { ...pr, number: have.number, url: have.url, action: 'updated' } };
  }
  const b = tmpFile(body);
  try {
    const made = await gh(['pr', 'create', '--repo', slug, '--base', base, '--head', head, '--title', title, '--body-file', b.f], { cwd: dir });
    if (!made.ok) return { error: `gh could not open the pull request: ${(made.stderr || made.stdout).trim()}` };
    const url = (made.stdout.match(/https?:\/\/\S+/) || [made.stdout.trim()])[0];
    return { pr: { ...pr, number: Number(/\/pull\/(\d+)/.exec(url)?.[1]) || null, url, action: 'opened' } };
  } finally { b.done(); }
}
