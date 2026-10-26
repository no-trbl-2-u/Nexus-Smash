// The fork's identity (spec 60): which repo this kit is, the npm package it publishes and where its docs live, read
// from kit.json instead of spelt out in the server, the bin or the UI.
//
// Two places hold kit.json: kit/kit.json, which scripts/bundle-kit.mjs copies from the repo root on every build (the
// published package carries it), and the repo root itself, two levels above this package (a clone run before any
// build). The first that reads as a full identity wins; with neither, the package's own package.json names the
// package and the repo, so a stray copy still says something true.
//
// Node only for the server and the bin; the UI gets the same values at build time (vite.config.mjs defines
// __NEXUS_KIT__ from uiKit(); src/data/kit.js reads it).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIELDS = ['repo', 'upstream', 'package', 'docs'];

/** Where kit.json is looked for, in order: the bundled copy, then the repo root. */
export const KIT_PATHS = [path.join(PKG, 'kit', 'kit.json'), path.resolve(PKG, '..', '..', 'kit.json')];

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

const whole = (k) => !!k && typeof k === 'object' && FIELDS.every((f) => typeof k[f] === 'string' && k[f]);

/** The identity from package.json alone: its name, and the owner/name its repository URL carries. */
export function fromPackage(pkg) {
  const name = typeof pkg?.name === 'string' ? pkg.name : '';
  const url = typeof pkg?.repository === 'string' ? pkg.repository : pkg?.repository?.url || '';
  const repo = /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(url)?.[1] || '';
  return { repo, upstream: '', package: name, docs: repo ? `https://github.com/${repo}/blob/main` : '' };
}

/** kit.json from the first of `paths` that holds a full identity, else what package.json says. */
export function loadKit(paths = KIT_PATHS, pkgFile = path.join(PKG, 'package.json')) {
  for (const p of paths) {
    const k = readJson(p);
    if (whole(k)) return { repo: k.repo, upstream: k.upstream, package: k.package, docs: k.docs.replace(/\/+$/, '') };
  }
  return fromPackage(readJson(pkgFile));
}

export const KIT = Object.freeze(loadKit());

/**
 * How a person starts the GUI today. The package is not on npm yet (publish.yml waits for NEXUS_PUBLISH), so the
 * way that works is a clone of this repo: `npm --prefix packages/cli ci` and `npm --prefix packages/cli run build`
 * once, then this line from the clone's root. Once the package publishes, this becomes `npx ${KIT.package}`.
 */
export const LAUNCH = 'node packages/cli/bin/nexus.mjs';

/** The repo's GitHub page, and its clone URL. */
export const kitUrl = (kit = KIT) => (kit.repo ? `https://github.com/${kit.repo}` : '');
export const cloneUrl = (kit = KIT) => (kit.repo ? `https://github.com/${kit.repo}.git` : '');

/** A kit doc's URL from its repo path (concepts/plan-shape.md). */
export const kitDoc = (rel, kit = KIT) => `${kit.docs}/${String(rel).replace(/^\/+/, '')}`;

/** What the UI is built with: the fields it shows, and the launch line. */
export const uiKit = (kit = KIT) => ({ repo: kit.repo, package: kit.package, docs: kit.docs, launch: LAUNCH });

/** The bin this package runs, as a path. */
export const BIN = path.join(PKG, 'bin', 'nexus.mjs');

/**
 * The line that starts this very copy again, for a hint the server prints while it runs: `npx <package>` when it was
 * installed from npm (it sits under node_modules), else node and this bin's own path (a clone), quoted when the path
 * has a space.
 */
export function launchLine({ kit = KIT, bin = BIN } = {}) {
  if (bin.split(/[\\/]/).includes('node_modules') && kit.package) return `npx ${kit.package}`;
  return `node ${/\s/.test(bin) ? `"${bin}"` : bin}`;
}
