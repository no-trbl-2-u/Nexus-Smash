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

