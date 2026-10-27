// A synthetic editorial v1 repo for the upgrade proofs (spec 58, A7): the measured shape of an hourly cloud loop that
// works a content queue, built with real git over a local bare origin so the converter reads real shas and dates.
//   - 52 done phases: 1..50 plus the letter-suffixed 4b and 15a; every sha spelling the converter reads (`(commit a)`,
//     a trailing backtick sha, an `a + b` ship pair, a bare phase log with the sha only there); titles with ". "
//   - skills/march.md and skills/iterate.md forked before v1.0.0 plus the loop's own text: a weekly trend-snapshot
//     gate, a content queue with its empty-queue /survey refill, a cross-link drain (fixtures/upgrade/*.pre-v1.md)
//   - .github/workflows/march.yml with cron `0 * * * *` (or `cron`), a daily ceiling of 60, a deploy token
//   - package.json with scripts.verify (the repo's own gate), a custom /survey skill and /publish command
// editorialV1(tmp, { cron }) builds the origin once per cron and reuses it; the clone it returns is stale and dirty.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const FIX = new URL('../fixtures/upgrade/', import.meta.url);
const fixture = (n) => fs.readFileSync(new URL(n, FIX), 'utf8');

export const env = { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com' };
export const git = (cwd, ...args) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { cwd, env, encoding: 'utf8', stdio: 'pipe' }).trim();
export const put = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
export const commit = (dir, msg) => { git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', msg); return git(dir, 'rev-parse', '--short', 'HEAD'); };

export const PHASES = 52;
export const CLOUD = '\n\nCloud-Run: https://example.invalid/runs/';

/** The v1 march.yml fixture with its cron line swapped (the fixture's own is the hourly `0 * * * *`). */
export const marchYml = (cron = '0 * * * *') => fixture('march.v1.yml').replace("- cron: '0 * * * *'", `- cron: '${cron}'`);

const buildPlan = (rows, log) => `# 01 — Build plan

## Status (at-a-glance)

${rows.join('\n')}

## Carry-overs / known gaps

- The reader survey is quarterly.

## Phase log (commit hashes)

${log.join('\n')}
`;

const base = new Map();
let runs = 0;

/** The shipped history: one commit per phase (two for an `a + b` pair), the build plan and its rows. */
function history(tmp, cron) {
  const bare = tmp('nexus-ed-origin-');
  git(bare, 'init', '-q', '--bare', '-b', 'main');
  const seed = tmp('nexus-ed-seed-');
  git(seed, 'init', '-q', '-b', 'main');
  git(seed, 'remote', 'add', 'origin', bare);
  put(seed, 'package.json', '{ "name": "@acme/field-notes", "scripts": { "verify": "node scripts/site-verify.mjs" } }\n');
  put(seed, 'scripts/site-verify.mjs', "import fs from 'node:fs';\nif (!fs.existsSync('content/QUEUE.md')) { console.error('content/QUEUE.md is missing'); process.exit(1); }\nconsole.log('site verify: ok');\n");
  put(seed, 'content/QUEUE.md', '# Queue\n\n- [x] the first piece\n');
  put(seed, 'content/STYLE.md', '# Style\n\nPlain, second person.\n');
  put(seed, 'data/snapshots/.gitkeep', '');
  put(seed, 'agents.md', '# Field notes — agents.md\n\nShip with /ship-a-phase; what ships next is plan/steps/01_build_plan.md. Pieces come from content/QUEUE.md.\n');
  commit(seed, `feat: bootstrap${CLOUD}0`);

  const ids = [];
  for (let n = 1; n <= 50; n++) {
    ids.push(String(n));
    if (n === 4) ids.push('4b');
    if (n === 15) ids.push('15a');
  }
  const rows = [];
  const log = [];
  for (const id of ids) {
    const n = parseInt(id, 10);
    const title = `${id === '4b' ? 'Hotfix' : id === '15a' ? 'Cross-links' : `Section ${n}`} pass`;
    put(seed, `src/p${id}.txt`, `${id}\n`);
    const sha = commit(seed, `feat: phase ${id}${CLOUD}${id}`);
    const style = n % 4;
    if (n >= 7 && n <= 9 && !/[a-z]/.test(id)) {
      // No sha on the row: only the bare, unbulleted phase log has it.
      rows.push(`- [x] Phase ${id} — ${title}. Wired into the weekly rotation`);
      log.push(`phase ${id} — ${sha} — ${title}, shipped from the log only`);
    } else if (style === 0 || /[a-z]/.test(id)) {
      rows.push(`- [x] Phase ${id} — ${title}. Adds the index and a feed (commit ${sha})`);
    } else if (style === 1) {
      rows.push(`- [x] Phase ${id} — ${title} — the archive and tag pages \`${sha}\``);
    } else if (style === 2) {
      put(seed, `src/p${id}-b.txt`, `${id}b\n`);
      const second = commit(seed, `feat: phase ${id} follow-up${CLOUD}${id}`);
      rows.push(`- [x] Phase ${id} — ${title}. Ships in two commits \`${sha}\` + \`${second}\``);
    } else {
      rows.push(`- [x] Phase ${id} — ${title} (the sitemap) (commit ${sha})`);
    }
  }
  put(seed, 'plan/README.md', '# Field notes plan\n\n> The v1 notes.\n\n---\n\n## Editorial calendar\n\nOur own section: it stays, in place.\n');
  put(seed, 'plan/steps/01_build_plan.md', buildPlan(rows, log));
  put(seed, 'plan/PHASE_CANDIDATES.md', '# Phase candidates\n\n(None.)\n');
  put(seed, 'skills/ship-a-phase.md', '# ship-a-phase\n');
  put(seed, '.claude/commands/ship-a-phase.md', 'Read skills/ship-a-phase.md.\n');
  put(seed, 'skills/march.md', fixture('march.pre-v1.md'));
  put(seed, 'skills/iterate.md', fixture('iterate.pre-v1.md'));
  put(seed, 'skills/survey.md', '# survey\n\nRefill content/QUEUE.md from content/inbox/, then return.\n');
  put(seed, '.claude/commands/survey.md', 'Read skills/survey.md and do it.\n');
  put(seed, '.claude/commands/publish.md', 'Build the issue from content/QUEUE.md, then send it.\n');
  put(seed, '.github/workflows/march.yml', marchYml(cron));
  commit(seed, `plan: the v1 plan${CLOUD}plan`);
  git(seed, 'push', '-q', 'origin', 'main');
  return { bare, seed };
}

/**
 * { bare, seed, local }: an origin with the editorial history and a clone of it that is stale (origin moves one
 * commit past it, a closed-queue note) and dirty (an edit and an untracked file the upgrade must never see).
 * `cron` is the march.yml schedule; the default is the measured hourly one.
 */
export function editorialV1(tmp, { cron = '0 * * * *' } = {}) {
  if (!base.has(cron)) base.set(cron, history(tmp, cron));
  const { bare, seed } = base.get(cron);
  const copy = tmp('nexus-ed-copy-');
  git(copy, 'clone', '-q', bare, '.');
  const local = tmp('nexus-ed-local-');
  git(local, 'clone', '-q', bare, '.');
  runs++;
  put(copy, 'content/QUEUE.md', `# Queue\n\n- [x] the first piece\n${Array.from({ length: runs }, (_, i) => `- [x] piece ${i + 2}\n`).join('')}`);
  commit(copy, `content: piece ${runs + 1}${CLOUD}queue`);
  git(copy, 'push', '-q', 'origin', 'main');
  put(local, 'agents.md', '# Field notes — agents.md\n\nA local edit, never committed.\n');
  put(local, 'scratch.txt', 'untracked\n');
  return { bare, seed, copy, local };
}

/** The local checkout's observable state: status, worktrees, HEAD, the dirty file. */
export const state = (dir) => ({ status: git(dir, 'status', '--porcelain'), worktrees: git(dir, 'worktree', 'list', '--porcelain'), head: git(dir, 'rev-parse', 'HEAD'), agents: fs.readFileSync(path.join(dir, 'agents.md'), 'utf8') });
