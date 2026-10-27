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
const T = (name, body) => `import assert from 'node:assert/strict';\nimport { test } from 'node:test';\n${body}\n`;
let repo;
let base;

// The added tests that pass on the base too: each needs a guard-test line, or the replay flags it.
const GUARDS = ['test/old.test.mjs', 'test/uses-helper.test.mjs', 'test/env.test.mjs'].map((f) => `guard-test: ${f} passes before and after, on purpose`).join('\n');

const git = (...args) => spawnSync('git', args, { cwd: repo, encoding: 'utf-8' });
const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), text); };
const judge = (bodyText, { baseSha = base, extra = [], env = {} } = {}) => {
  const f = path.join(repo, '..', `body-${Math.random().toString(36).slice(2)}.md`);
  fs.writeFileSync(f, bodyText);
  return spawnSync(process.execPath, [SCRIPT, f, '--root', repo, '--base', baseSha, ...extra], { encoding: 'utf-8', env: { ...process.env, ...env } });
};

before(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-acc-'));
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  put('src.mjs', 'export const v = 1;\n');
  put('plan/10-x.md', '## Acceptance\n\n- **A1** the thing works.\n- **A2** another.\n');
  put('test/pre.test.mjs', T('pre', "test('pre', () => assert.ok(true));"));
  git('add', '-A');
  git('commit', '-qm', 'base');
  base = git('rev-parse', 'HEAD').stdout.trim();
  put('src.mjs', 'export const v = 2;\n');
  put('plan/10-x.md', '## Acceptance\n\n- **A2** another.\n');
  put('test/new.test.mjs', T('new', "import { v } from '../src.mjs';\ntest('v is 2', () => assert.equal(v, 2));"));
  put('test/old.test.mjs', T('old', "import { v } from '../src.mjs';\ntest('v is a number', () => assert.equal(typeof v, 'number'));"));
  put('test/red.test.mjs', "import { test } from 'node:test';\ntest('red', () => { throw new Error('no'); });\n");
  put('test/helper.mjs', 'export const ok = true;\n');
  put('test/uses-helper.test.mjs', T('uh', "import { ok } from './helper.mjs';\ntest('helper', () => assert.equal(ok, true));"));
  put('test/empty.test.mjs', "// no tests in here\n");
  put('test/env.test.mjs', T('env', "test('no token reaches a proof', () => assert.equal(process.env.NEXUS_SECRET_PROBE, undefined));"));
  git('add', '-A');
  git('commit', '-qm', 'head');
});
after(() => fs.rmSync(repo, { recursive: true, force: true }));

describe('acceptance.mjs on a scratch repo', () => {
  it('passes: the spec diff closes A1, its proof is green and fails on the base', () => {
    const r = judge(`## Acceptance\n- A1 · test/new.test.mjs\n\n${GUARDS}\n`);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /\| A1 \|/);
  });

  it('fails a closed ID (read from the spec diff) with no proof line', () => {
    const r = judge(`## Acceptance\n- A7 · (no test: unrelated)\n\n${GUARDS}\n`);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /A1: closed with no proof line/);
  });

  it('fails a proof file that is missing, and one that is red', () => {
    assert.match(judge(`## Acceptance\n- A1 · test/gone.test.mjs\n\n${GUARDS}\n`).stderr, /A1: proof file missing/);
    const red = judge(`## Acceptance\n- A1 · test/red.test.mjs\n\n${GUARDS}\n`);
    assert.equal(red.status, 1);
    assert.match(red.stderr, /A1: proof is red/);
  });

  it('fails an added test that passes on the merge base unless guard-test names it', () => {
    const r = judge('## Acceptance\n- A1 · test/new.test.mjs\n');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /test\/old\.test\.mjs: passes on the merge base/);
    assert.doesNotMatch(r.stderr, /test\/new\.test\.mjs: passes/);
  });

  it('review 1: a proof line with spaces is not run, and no shell sees it', () => {
    const canary = path.join(repo, 'canary.txt');
    const r = judge(`## Acceptance\n- A1 · node -e "require('fs').writeFileSync('canary.txt','x')"\n\n${GUARDS}\n`);
    assert.equal(r.status, 1);
    assert.equal(fs.existsSync(canary), false);
    const r2 = judge(`## Acceptance\n- A1 · echo pwned > canary.txt\n\n${GUARDS}\n`);
    assert.equal(r2.status, 1);
    assert.equal(fs.existsSync(canary), false);
  });

  it('review 1: a proof runs with no token in its environment', () => {
    const r = judge(`## Acceptance\n- A1 · test/env.test.mjs\n\n${GUARDS}\n`, { env: { NEXUS_SECRET_PROBE: 'leak' } });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  it('review 2: an unusable --base fails loud instead of passing', () => {
    const bogus = judge(`## Acceptance\n- A1 · test/new.test.mjs\n`, { baseSha: 'deadbeef'.repeat(5) });
    assert.notEqual(bogus.status, 0);
    assert.match(bogus.stderr, /base/i);
  });

  it('review 3 and 4: a helper under test/ is not a test, and a test that needs it is replayed with it', () => {
    const r = judge('## Acceptance\n- A1 · test/new.test.mjs\n\nguard-test: test/old.test.mjs why\nguard-test: test/env.test.mjs why\n');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /test\/uses-helper\.test\.mjs: passes on the merge base/);
    assert.doesNotMatch(r.stderr, /test\/helper\.mjs/);
  });

  it('review 5: an empty test file, and a test the PR did not touch, are not proofs', () => {
    const empty = judge(`## Acceptance\n- A1 · test/empty.test.mjs\n\n${GUARDS}\n`);
    assert.equal(empty.status, 1);
    assert.match(empty.stderr, /A1: proof is red/);
    const pre = judge(`## Acceptance\n- A1 · test/pre.test.mjs\n\n${GUARDS}\n`);
    assert.equal(pre.status, 1);
    assert.match(pre.stderr, /A1: .*not (added or )?changed|untouched/i);
  });
});
