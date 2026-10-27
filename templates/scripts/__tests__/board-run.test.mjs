// board.mjs end to end: the CLI reads the board off a real claims branch in a scratch clone. Snapshot prints what a
// second writer added since this session's last one, FAIL first, and the cursor lands in .nexus/board-cursor.json of the
// primary checkout (shared by its worktrees); grep and unfold read the same branch. Offline, but every case spawns git
// and node (the opt-in `scripts-git` gate leg). node:test, no deps.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { postNote } from '../claims.mjs';

const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') && !k.startsWith('NEXUS_') && !k.startsWith('CLAUDE')));
for (const k of Object.keys(process.env)) if (k.startsWith('GIT_')) delete process.env[k];

const BOARD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../board.mjs');
let dir;
let clone;
after(() => fs.rmSync(dir, { recursive: true, force: true }));

function git(cwd, ...args) {
  const res = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: ENV });
  if (res.status !== 0) throw new Error(`git ${args.join(' ')}: ${res.stderr}`);
  return res.stdout.trim();
}
const board = (cwd, session, ...args) => spawnSync('node', [BOARD, ...args], { cwd, encoding: 'utf8', env: { ...ENV, NEXUS_SESSION: session } });
const note = (type, text, extra = {}) => ({ type, chunk: '62.2', by: 'alex', session: 's1', text, ...extra });

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-board-run-'));
  const origin = path.join(dir, 'origin.git');
  git(dir, 'init', '-q', '--bare', '-b', 'main', origin);
  clone = path.join(dir, 'clone');
  git(dir, 'clone', '-q', origin, clone);
  git(clone, 'config', 'user.name', 'alex');
  git(clone, 'config', 'user.email', 'alex@example.com');
  git(clone, 'config', 'core.hooksPath', path.join(dir, 'no-hooks'));
  fs.writeFileSync(path.join(clone, 'README.md'), '# scratch\n');
  git(clone, 'add', '-A');
  git(clone, 'commit', '-q', '-m', 'seed');
  git(clone, 'push', '-q', 'origin', 'HEAD:main');
});

describe('board.mjs over a claims branch', () => {
  it('snapshot, then a second writer, then snapshot again shows only the new entries, FAIL first', () => {
    postNote(clone, note('FACT', 'the cursor lives under .nexus'), { remote: 'origin' });
    postNote(clone, note('PATCH', 'board.mjs added'), { remote: 'origin' });
    const first = board(clone, 'sess-a', 'snapshot');
    assert.equal(first.status, 0, first.stderr);
    assert.deepEqual(first.stdout.trim().split('\n').map((l) => l.split(' ')[0]), ['b2', 'b1']);
    assert.equal(board(clone, 'sess-a', 'snapshot').stdout.trim(), 'board: nothing new.');

    postNote(clone, note('OBSERVED', 'grep walks the history', { by: 'sam', session: 's2' }), { remote: 'origin' });
    postNote(clone, note('FAIL', 'npm test: board-run.test.mjs fails on unfold', { by: 'sam', session: 's2', detail: 'stack line 1\nstack line 2' }), { remote: 'origin' });
    const second = board(clone, 'sess-a', 'snapshot');
    assert.deepEqual(second.stdout.trim().split('\n').map((l) => l.split(' ')[0]), ['b4', 'b3']);
    assert.match(second.stdout, /^b4 FAIL 62\.2 sam:/);

    // another session has its own cursor and sees everything once
    assert.equal(board(clone, 'sess-b', 'snapshot').stdout.trim().split('\n').length, 4);
    const cursors = JSON.parse(fs.readFileSync(path.join(clone, '.nexus', 'board-cursor.json'), 'utf8'));
    assert.deepEqual(cursors, { 'sess-a': 4, 'sess-b': 4 });
  });

  it('grep and unfold read the same branch; a bad expression exits 1 with the message', () => {
    const hit = board(clone, 'sess-a', 'grep', 'FAIL & (sam | alex)');
    assert.equal(hit.status, 0, hit.stderr);
    assert.match(hit.stdout, /^b4 FAIL/);
    assert.equal(hit.stdout.trim().split('\n').length, 1);
    const un = board(clone, 'sess-a', 'unfold', 'b4');
    assert.equal(un.status, 0, un.stderr);
    assert.match(un.stdout, /stack line 1\nstack line 2/);
    const bad = board(clone, 'sess-a', 'grep', '(FAIL');
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /grep: the "\(" at column 1 is never closed/);
  });
});
