// pr/acceptance.mjs end to end (spec 61 A1): a scratch git repo, the real gitIo and the CLI. A test the PR adds is
// replayed on the merge base; the live plan/ is never touched. Opt-in (scripts-git leg): it spawns git and node.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'pr', 'acceptance.mjs');
let repo;
let base;

const git = (...args) => spawnSync('git', args, { cwd: repo, encoding: 'utf-8' });
const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), text); };
const judge = (bodyText, ...extra) => {
  const f = path.join(repo, '..', `body-${Math.random().toString(36).slice(2)}.md`);
  fs.writeFileSync(f, bodyText);
  return spawnSync(process.execPath, [SCRIPT, f, '--root', repo, '--base', base, ...extra], { encoding: 'utf-8' });
};

before(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-acc-'));
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  put('src.mjs', 'export const v = 1;\n');
  put('plan/10-x.md', '## Acceptance\n\n- **A1** the thing works.\n- **A2** another.\n');
  git('add', '-A');
  git('commit', '-qm', 'base');
  base = git('rev-parse', 'HEAD').stdout.trim();
  put('src.mjs', 'export const v = 2;\n');
  put('plan/10-x.md', '## Acceptance\n\n- **A2** another.\n');
  put('test/new.test.mjs', "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { v } from '../src.mjs';\ntest('v is 2', () => assert.equal(v, 2));\n");
  put('test/old.test.mjs', "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { v } from '../src.mjs';\ntest('v is a number', () => assert.equal(typeof v, 'number'));\n");
  put('test/red.test.mjs', "import { test } from 'node:test';\ntest('red', () => { throw new Error('no'); });\n");
  git('add', '-A');
  git('commit', '-qm', 'head');
});
after(() => fs.rmSync(repo, { recursive: true, force: true }));

describe('acceptance.mjs on a scratch repo', () => {
  it('passes: the spec diff closes A1, its proof is green and fails on the base', () => {
    const r = judge('## Acceptance\n- A1 · test/new.test.mjs\n\nguard-test: test/old.test.mjs passes before and after, on purpose\n');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /\| A1 \|/);
  });

  it('fails a closed ID (read from the spec diff) with no proof line', () => {
    const r = judge('## Acceptance\n- A7 · (no test: unrelated)\n\nguard-test: test/old.test.mjs why\n');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /A1: closed with no proof line/);
  });

  it('fails a proof file that is missing, and one that is red', () => {
    assert.match(judge('## Acceptance\n- A1 · test/gone.test.mjs\n\nguard-test: test/old.test.mjs why\n').stderr, /A1: proof file missing/);
    const red = judge('## Acceptance\n- A1 · test/red.test.mjs\n\nguard-test: test/old.test.mjs why\n');
    assert.equal(red.status, 1);
    assert.match(red.stderr, /A1: proof is red/);
  });

  it('fails an added test that passes on the merge base unless guard-test names it', () => {
    const r = judge('## Acceptance\n- A1 · test/new.test.mjs\n');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /test\/old\.test\.mjs: passes on the merge base/);
    assert.doesNotMatch(r.stderr, /test\/new\.test\.mjs: passes/);
  });
});
