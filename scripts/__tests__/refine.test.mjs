// refine.mjs (spec 64.2, A2): under Improve: bold the context lands as files and a proposal of 2 inv + 2 dom candidates
// citing real evidence (or KEEP_BASE) validates; under any lower dial the script exits 0 with one reason line and writes
// nothing. Pure: scratch repos with bearings fixtures, no model, no git.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { FILES, MISSION_MAX, checkProposal, contextDir, main, mission } from '../refine.mjs';

const bearings = (dial) => ['# Bearings', '', '## Plan expansion posture', '', ...(dial ? [`Improve: ${dial}`] : []), '', '## Generators', '', '- (none)', ''].join('\n');
const ARCHIVE = [
  '# Archive',
  '- 2026-10-20 · 40.1 · /tidy sweeps dead claims · a..b',
  '- 2026-10-21 · 41.1 · unrelated chunk · c..d',
  '- 2026-10-22 · 41.2 · skills/tidy.md learns branches · e..f',
  '- 2026-10-23 · 41.3 · /tidy dry mode · g..h',
  '- 2026-10-24 · 41.4 · /tidy prunes context · i..j',
  '',
].join('\n');
const FOOTGUNS = [
  '# Footguns',
  '## Open',
  '- **tidy-live-session** · tidy closed a worktree a live session held → check the claim first · seen 2× · last 2026-10-20 · open',
  '- **other-trap** · something else → rule · seen 1× · last 2026-10-20 · open',
  '## Guarded',
  '- **tidy-guarded** · old tidy trap → rule · seen 3× · last 2026-10-01 · guarded by test',
  '',
].join('\n');

function repo(dial, { files = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refine-'));
  const put = (p, t) => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), t); };
  put('plan/bearings.md', bearings(dial));
  put('plan/ARCHIVE.md', ARCHIVE);
  put('identity/footguns.md', FOOTGUNS);
  put('skills/tidy.md', '# Skill: tidy\n\nstep one\nstep two\n');
  put('skills/refine.md', '# Skill: refine\n');
  for (const [p, t] of Object.entries(files)) put(p, t);
  return dir;
}
const run = (args, root) => {
  const out = []; const errs = [];
  const code = main(args, { root, log: (l) => out.push(l), err: (l) => errs.push(l) });
  return { code, out, errs };
};
const ctx = (root) => contextDir(root, 'tidy');
const cand = (id, lens, evidence = 'footguns.md:1') => ({ id, lens, target: 'skills/tidy.md', edit: 'check the claim before closing', evidence });
const good = () => ({ candidates: [cand('a', 'inv'), cand('b', 'inv', 'closes.md:2'), cand('c', 'dom'), cand('d', 'dom', 'skill.md:3')] });

describe('the dial gate', () => {
  for (const dial of ['off', 'gentle', 'steady', undefined]) {
    it(`Improve ${dial ?? 'absent'}: one reason line, exit 0, nothing written`, () => {
      const root = repo(dial);
      const r = run(['tidy'], root);
      assert.equal(r.code, 0);
      assert.equal(r.out.length, 1);
      assert.match(r.out[0], /skipped.*bold/);
      assert.ok(!fs.existsSync(path.join(root, '.scratch')));
      const c = run(['tidy', '--check', 'x.json'], root);
      assert.equal(c.code, 0);
      assert.equal(c.out.length, 1);
    });
  }
  it('bold proceeds', () => {
    const r = run(['tidy'], repo('bold'));
    assert.equal(r.code, 0);
    assert.match(r.out[0], /context written/);
  });
});

describe('the evidence context', () => {
  it('writes every file, the last 3 closes of the verb, and only the verb\'s open footguns', () => {
    const root = repo('bold');
    run(['tidy'], root);
    for (const f of FILES) assert.ok(fs.existsSync(path.join(ctx(root), f)), f);
    const closes = fs.readFileSync(path.join(ctx(root), 'closes.md'), 'utf8').trim().split('\n');
    assert.deepEqual(closes.map((l) => l.split(' · ')[1]), ['41.2', '41.3', '41.4']);
    const fg = fs.readFileSync(path.join(ctx(root), 'footguns.md'), 'utf8');
    assert.match(fg, /tidy-live-session/);
    assert.doesNotMatch(fg, /other-trap|tidy-guarded/);
    assert.match(fs.readFileSync(path.join(ctx(root), 'skill.md'), 'utf8'), /step two/);
  });
  it('picks escape-ledger rows that name the verb; says so when none do', () => {
    const root = repo('bold', { files: { 'plan/eval/ledger.md': '- PR 3: merged before checks, /tidy changed\n- PR 4: unrelated\n' } });
    run(['tidy'], root);
    const e = fs.readFileSync(path.join(ctx(root), 'escapes.md'), 'utf8');
    assert.match(e, /PR 3/);
    assert.doesNotMatch(e, /PR 4/);
    const none = repo('bold');
    run(['tidy'], none);
    assert.match(fs.readFileSync(path.join(ctx(none), 'escapes.md'), 'utf8'), /no escape-ledger row/);
  });
  it('walk rows only when the verb touches the GUI', () => {
    const walk = { 'skills/tidy.md': '# Skill: tidy\n\nopen the GUI\n', '.scratch/walk/2026-10-26/walk.json': '{"findings":[1]}' };
    const root = repo('bold', { files: walk });
    run(['tidy'], root);
    assert.match(fs.readFileSync(path.join(ctx(root), 'walk.md'), 'utf8'), /findings/);
    const plain = repo('bold', { files: { '.scratch/walk/2026-10-26/walk.json': '{"findings":[1]}' } });
    run(['tidy'], plain);
    assert.match(fs.readFileSync(path.join(ctx(plain), 'walk.md'), 'utf8'), /does not touch the GUI/);
  });
  it('mission.md is at most 20 lines and names every other file', () => {
    const root = repo('bold');
    run(['tidy'], root);
    const m = fs.readFileSync(path.join(ctx(root), 'mission.md'), 'utf8');
    assert.ok(m.trimEnd().split('\n').length <= MISSION_MAX);
    for (const f of FILES.filter((x) => x !== 'mission.md')) assert.ok(m.includes(f), f);
    assert.ok(mission('tidy', 2).includes('KEEP_BASE'));
  });
  it('--dry writes nothing; an unknown verb and refine itself exit 2', () => {
    const root = repo('bold');
    assert.equal(run(['tidy', '--dry'], root).code, 0);
    assert.ok(!fs.existsSync(path.join(root, '.scratch')));
    assert.equal(run(['nope'], root).code, 2);
    assert.equal(run(['refine'], root).code, 2);
    assert.equal(run([], root).code, 2);
  });
});

describe('proposal validation', () => {
  const root = repo('bold');
  run(['tidy'], root);
  const dir = ctx(root);
  const check = (p, k = 2) => checkProposal(p, dir, k);

  it('accepts 2 inv + 2 dom candidates that cite existing evidence lines', () => {
    const v = check(good());
    assert.deepEqual(v.problems, []);
    assert.ok(v.ok && !v.keepBase);
  });
  it('accepts KEEP_BASE as a whole proposal; rejects it mixed with candidates or misspelled', () => {
    assert.ok(check({ answer: 'KEEP_BASE', reason: 'no evidence supports an edit' }).keepBase);
    assert.ok(!check({ answer: 'KEEP_BASE', candidates: good().candidates }).ok);
    assert.ok(!check({ answer: 'keep' }).ok);
  });
  it('rejects the wrong lens counts', () => {
    const g = good().candidates;
    assert.match(check({ candidates: g.slice(0, 3) }).problems.join(), /exactly 2 dom candidates, got 1/);
    assert.match(check({ candidates: [...g, cand('e', 'inv')] }).problems.join(), /exactly 2 inv candidates, got 3/);
    assert.match(check({ candidates: [{ ...g[0], lens: 'other' }, ...g.slice(1)] }).problems.join(), /lens must be inv or dom/);
  });
  it('rejects evidence that is missing, malformed, out of range, or outside the context dir', () => {
    const bad = (evidence) => check({ candidates: [cand('a', 'inv', evidence), ...good().candidates.slice(1)] }).problems.join();
    assert.match(bad(null), /<file>:<line>/);
    assert.match(bad('footguns.md'), /<file>:<line>/);
    assert.match(bad('nope.md:1'), /does not exist/);
    assert.match(bad('footguns.md:99'), /outside footguns\.md/);
    assert.match(bad('footguns.md:0'), /outside footguns\.md/);
    assert.match(bad('../../../plan/bearings.md:1'), /outside the context dir/);
  });
  it('rejects a duplicate id, a missing edit or target, and non-objects', () => {
    const g = good().candidates;
    assert.match(check({ candidates: [g[0], { ...g[1], id: 'a' }, g[2], g[3]] }).problems.join(), /duplicate id a/);
    assert.match(check({ candidates: [{ ...g[0], edit: '' }, ...g.slice(1)] }).problems.join(), /no edit/);
    assert.match(check({ candidates: [{ ...g[0], target: undefined }, ...g.slice(1)] }).problems.join(), /no target/);
    assert.ok(!check(null).ok && !check([]).ok && !check({}).ok);
  });
  it('--k changes the required count', () => {
    assert.ok(!check(good(), 1).ok);
    assert.ok(check({ candidates: [cand('a', 'inv'), cand('c', 'dom')] }, 1).ok);
  });
  it('--check through main: exit 0 for valid and KEEP_BASE, 1 for invalid or unparseable', () => {
    const w = (name, body) => { const f = path.join(root, name); fs.writeFileSync(f, typeof body === 'string' ? body : JSON.stringify(body)); return f; };
    assert.equal(run(['tidy', '--check', w('ok.json', good())], root).code, 0);
    const kb = run(['tidy', '--check', w('kb.json', { answer: 'KEEP_BASE' })], root);
    assert.equal(kb.code, 0);
    assert.match(kb.out[0], /KEEP_BASE accepted/);
    const bad = run(['tidy', '--check', w('bad.json', { candidates: [] })], root);
    assert.equal(bad.code, 1);
    assert.ok(bad.errs.length >= 2);
    assert.equal(run(['tidy', '--check', w('junk.json', 'not json')], root).code, 1);
  });
});
