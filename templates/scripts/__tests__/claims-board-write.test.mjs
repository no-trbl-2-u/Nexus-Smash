// The board over git: board.json rides the claims branch's compare-and-swap. Two clones write the same FACT (one entry,
// (x2)); a PATCH is replaced and a FAIL invalidates through origin; a cap breach never reaches origin; a lost race is
// redone on the new tip and never drops an entry (forced deterministically, then with real concurrent processes); an
// unreadable board.json is never overwritten; claims and the board share the branch without clobbering each other.
// Each case builds scratch repositories in the temp folder: offline, but every case spawns git (the opt-in `scripts-git`
// gate leg). node:test, no deps.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { addNote, live, parseBoard, render } from '../claims-codec.mjs';
import { claim, fetchBoard, fetchClaims, postNote, updateBoard } from '../claims.mjs';

// A git hook's GIT_DIR or GIT_WORK_TREE would point these commands at the real repository: never inherit them.
const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
for (const k of Object.keys(process.env)) if (k.startsWith('GIT_')) delete process.env[k];

const CLAIMS = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../claims.mjs')).href;
const dirs = [];
after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

function git(cwd, ...args) {
  const res = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: ENV });
  if (res.status !== 0) throw new Error(`git ${args.join(' ')}: ${res.stderr}`);
  return res.stdout.trim();
}

let dir, origin, a, b;
function clone(name) {
  const p = path.join(dir, name);
  git(dir, 'clone', '-q', origin, p);
  git(p, 'config', 'user.name', name);
  git(p, 'config', 'user.email', `${name}@example.com`);
  git(p, 'config', 'core.hooksPath', path.join(dir, 'no-hooks'));
  return p;
}

const note = (type, text, extra = {}) => ({ type, chunk: '62.1', by: 'alex', session: 's1', text, ...extra });
const sam = (type, text, extra = {}) => note(type, text, { by: 'sam', session: 's2', ...extra });
const dev = (who) => ({ owner: false, who, ip: '10.0.0.2', host: `${who}-pc`, session: `${who}-s1` });
/** What origin holds, read from a fresh clone's point of view. */
const onOrigin = (cwd) => fetchBoard(cwd).board;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-board-'));
  dirs.push(dir);
  origin = path.join(dir, 'origin.git');
  git(dir, 'init', '-q', '--bare', '-b', 'main', origin);
  const seed = path.join(dir, 'seed');
  git(dir, 'init', '-q', '-b', 'main', seed);
  fs.writeFileSync(path.join(seed, 'README.md'), '# scratch\n');
  git(seed, 'add', '-A');
  git(seed, '-c', 'user.name=s', '-c', 'user.email=s@example.com', 'commit', '-q', '-m', 'seed');
  git(seed, 'push', '-q', origin, 'main');
  a = clone('alex');
  b = clone('sam');
});

describe('the board on the claims branch', () => {
  it('the first note makes the orphan branch with board.json beside the README; an empty branch reads as an empty board', () => {
    assert.equal(fetchBoard(a).tip, null);
    assert.deepEqual(fetchBoard(a).board.entries, []);
    const r = postNote(a, note('FACT', 'the gate runs foreground'));
    assert.equal(r.outcome, 'added');
    const { tip, board } = fetchBoard(b);
    assert.deepEqual(git(b, 'ls-tree', '--name-only', tip).split('\n').sort(), ['README.md', 'board.json']);
    assert.equal(git(b, 'rev-list', '--max-parents=0', tip), tip);
    assert.equal(board.entries[0].text, 'the gate runs foreground');
    assert.equal(board.entries[0].id, 'b1');
  });

  it('claims and the board share the branch without clobbering each other', () => {
    assert.equal(claim(a, ['62.1'], dev('alex')).ok, true);
    postNote(b, sam('FACT', 'a fact after a claim'));
    assert.equal(claim(a, ['62.2'], dev('alex')).ok, true);
    postNote(a, note('FACT', 'a fact after a second claim'));
    assert.deepEqual(Object.keys(fetchClaims(b).map), ['62.1', '62.2']);
    assert.deepEqual(onOrigin(b).entries.map((e) => e.text), ['a fact after a claim', 'a fact after a second claim']);
    const { tip } = fetchBoard(a);
    assert.deepEqual(git(a, 'ls-tree', '--name-only', tip).split('\n').sort(), ['README.md', 'board.json', 'claims.json']);
  });

  it('a board written first leaves claims.json absent, and the first claim creates it', () => {
    postNote(a, note('FACT', 'board first'));
    assert.deepEqual(fetchClaims(b).map, {});
    assert.equal(claim(b, ['62.1'], dev('sam')).ok, true);
    assert.deepEqual(Object.keys(fetchClaims(a).map), ['62.1']);
    assert.equal(onOrigin(a).entries.length, 1);
  });
});

describe('A1 through origin', () => {
  it('two sessions writing the same FACT produce one entry with (x2)', () => {
    assert.equal(postNote(a, note('FACT', 'steer.mjs drains the notice board')).outcome, 'added');
    const second = postNote(b, sam('FACT', 'steer.mjs drains the notice board'));
    assert.equal(second.outcome, 'duplicate');
    const entries = onOrigin(a).entries;
    assert.equal(entries.length, 1);
    assert.equal(render(entries[0]), 'steer.mjs drains the notice board (x2)');
    assert.equal(entries[0].by, 'alex');
  });

  it("a PATCH is replaced by its author's next for the same chunk, and only by theirs", () => {
    postNote(a, note('PATCH', 'codec and tests'));
    postNote(b, sam('PATCH', 'sam: docs'));
    const r = postNote(a, note('PATCH', 'codec, tests and the write path'));
    assert.equal(r.outcome, 'replaced');
    const { entries } = onOrigin(b);
    assert.equal(entries.length, 3, 'append-only: the replaced PATCH stays in the history');
    assert.deepEqual(live(entries).map((e) => e.text), ['sam: docs', 'codec, tests and the write path']);
  });

  it('a FAIL naming the chunk marks its latest PATCH invalidated', () => {
    postNote(a, note('PATCH', 'landed the codec'));
    postNote(a, note('PATCH', 'landed the codec', { chunk: '62.2' }));
    const r = postNote(b, sam('FAIL', 'verify.mjs: tree leg red after the rebase'));
    assert.equal(r.entry.invalidates, 'b1');
    const { entries } = onOrigin(a);
    assert.equal(entries[0].invalidated, true);
    assert.equal(render(entries[0]), 'landed the codec [invalidated]');
    assert.equal(entries[1].invalidated, undefined, 'a PATCH for another chunk is untouched');
  });

  it('caps are enforced and a refused note never reaches origin', () => {
    postNote(a, note('FACT', 'x'.repeat(100)));
    postNote(a, note('PATCH', 'y'.repeat(300)));
    const tip = fetchBoard(a).tip;
    assert.throws(() => postNote(a, note('FACT', 'x'.repeat(101))), /101 characters/);
    assert.throws(() => postNote(a, note('PATCH', 'y'.repeat(301))), /301 characters/);
    assert.throws(() => postNote(a, note('CLAIM', 'mirrors claims.json')), /read-only/);
    assert.equal(fetchBoard(b).tip, tip, 'origin did not move');
    assert.equal(onOrigin(b).entries.length, 2);
    // detail is unbounded and rides along
    postNote(a, note('FAIL', 'a long log', { detail: 'z'.repeat(5000) }));
    assert.equal(onOrigin(b).entries[2].detail.length, 5000);
  });

  it('a lost compare-and-swap race retries on the new tip and drops no entry', () => {
    postNote(a, note('FACT', 'before the race'));
    let calls = 0;
    const res = updateBoard(a, (board) => {
      calls++;
      // Between this writer's fetch and its push, another clone's note lands first: the push below must lose.
      if (calls === 1) postNote(b, sam('FACT', 'sam got in first'));
      const out = addNote(board, note('FACT', 'alex lost the race'), Date.now());
      return { board: out.board, message: 'board test' };
    });
    assert.equal(calls, 2, 'the change was redone once on the new tip');
    assert.equal(res.tries, 2);
    const { entries } = onOrigin(b);
    assert.deepEqual(entries.map((e) => e.text), ['before the race', 'sam got in first', 'alex lost the race']);
    assert.deepEqual(entries.map((e) => e.id), ['b1', 'b2', 'b3'], 'ids stay unique and climb');
  });

  it('a race over the same FACT still folds to one entry, counted twice', () => {
    postNote(a, note('FACT', 'seed'));
    let calls = 0;
    updateBoard(a, (board) => {
      if (++calls === 1) postNote(b, sam('FACT', 'both found this'));
      return { board: addNote(board, note('FACT', 'both found this'), Date.now()).board, message: 'board test' };
    });
    const { entries } = onOrigin(b);
    assert.equal(entries.length, 2);
    assert.equal(render(entries[1]), 'both found this (x2)');
  });

  it('out of tries is loud and still drops nothing: the other writer\'s entry stands', () => {
    postNote(a, note('FACT', 'before'));
    assert.throws(
      () =>
        updateBoard(
          a,
          (board) => {
            postNote(b, sam('FACT', `sam wins again ${Math.random()}`));
            return { board: addNote(board, note('FACT', 'never lands'), Date.now()).board, message: 'board test' };
          },
          { tries: 2 },
        ),
      /kept moving; 2 tries lost the race/,
    );
    const texts = onOrigin(a).entries.map((e) => e.text);
    assert.equal(texts.length, 3);
    assert.ok(!texts.includes('never lands'));
  });

  it('concurrent writers in separate processes each land their note', async () => {
    postNote(a, note('FACT', 'seed so the branch exists'));
    const writers = ['p1', 'p2', 'p3'].map((name) => {
      const wd = clone(name);
      const code = `import { postNote } from ${JSON.stringify(CLAIMS)}; const r = postNote(process.cwd(), { type: 'FACT', chunk: '62.1', by: ${JSON.stringify(name)}, session: ${JSON.stringify(name)}, text: ${JSON.stringify(`fact from ${name}`)} }); console.log(JSON.stringify(r));`;
      return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['--input-type=module', '-e', code], { cwd: wd, env: ENV });
        let out = '';
        let err = '';
        child.stdout.on('data', (d) => (out += d));
        child.stderr.on('data', (d) => (err += d));
        child.on('close', (status) => (status === 0 ? resolve(JSON.parse(out)) : reject(new Error(err))));
      });
    });
    const results = await Promise.all(writers);
    assert.equal(results.length, 3);
    const { entries } = onOrigin(a);
    assert.deepEqual(entries.map((e) => e.text).sort(), ['fact from p1', 'fact from p2', 'fact from p3', 'seed so the branch exists']);
    assert.equal(new Set(entries.map((e) => e.id)).size, 4, 'no id was handed out twice');
  });

  it('refuses to write over a board.json it cannot read, rather than wiping it', () => {
    postNote(a, note('FACT', 'precious'));
    const bad = spawnSync('git', ['-C', a, 'hash-object', '-w', '--stdin'], { input: 'not json', encoding: 'utf8', env: ENV }).stdout.trim();
    const tip = git(a, 'rev-parse', 'refs/remotes/origin/claims');
    const tree = spawnSync('git', ['-C', a, 'mktree'], { input: `100644 blob ${bad}\tboard.json\n`, encoding: 'utf8', env: ENV }).stdout.trim();
    const commit = git(a, 'commit-tree', tree, '-p', tip, '-m', 'broken');
    git(a, 'push', '-q', 'origin', `${commit}:refs/heads/claims`);
    assert.throws(() => postNote(b, sam('FACT', 'would wipe')), /board\.json at .* can't be read/);
    assert.equal(git(b, 'rev-parse', 'refs/remotes/origin/claims'), commit);
    assert.throws(() => parseBoard('not json'), /can't be read/);
  });
});
