// claims-codec.mjs, the board half: board.json's rules as pure functions (no git). Two sessions writing the same FACT
// make one entry rendered (x2); a PATCH is replaced by its author's next for the same chunk; a FAIL naming the chunk
// marks its latest PATCH invalidated; the caps hold (text 100, PATCH 300, detail unbounded); an unreadable file throws
// instead of reading as empty. claims-board-write.test.mjs proves the compare-and-swap over git. node:test, no deps.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as codec from '../claims-codec.mjs';

const T0 = Date.parse('2026-10-27T09:00:00Z');
const note = (type, text, extra = {}) => ({ type, chunk: '62.1', by: 'alex', session: 's1', text, ...extra });
/** Fold notes into a board, one minute apart. */
function fold(notes, board = codec.emptyBoard()) {
  let b = board;
  const outs = [];
  notes.forEach((n, i) => {
    const out = codec.addNote(b, n, T0 + i * 60_000);
    outs.push(out);
    b = out.board;
  });
  return { board: b, outs };
}

describe('the file', () => {
  it('serializes to two-space JSON with a newline and parses back', () => {
    const { board } = fold([note('FACT', 'steer.mjs reads the deny reason')]);
    const text = codec.serializeBoard(board);
    assert.ok(text.endsWith('}\n'));
    assert.deepEqual(codec.parseBoard(text), board);
  });
  it('lives beside claims.json on the claims branch', () => {
    assert.equal(codec.BOARD_FILE, 'board.json');
    assert.equal(codec.BRANCH, 'claims');
  });
  it('an empty board has no entries and a sequence of zero', () => {
    assert.deepEqual(codec.emptyBoard(), { v: 1, seq: 0, entries: [] });
  });
  it('an unreadable file throws, never reads as empty', () => {
    assert.throws(() => codec.parseBoard('{not json', 'abc12345'), /board\.json at abc12345 can't be read/);
    assert.throws(() => codec.parseBoard('[]'), /not a board/);
    assert.throws(() => codec.parseBoard('{"v":1,"seq":0}'), /not a board/);
  });
});

describe('a note', () => {
  it('becomes an entry with the fields the spec names', () => {
    const { board, outs } = fold([note('FAIL', 'node scripts/verify.mjs: tree leg red', { detail: 'full output here' })]);
    assert.equal(outs[0].outcome, 'added');
    const e = board.entries[0];
    assert.deepEqual(
      { id: e.id, type: e.type, chunk: e.chunk, by: e.by, session: e.session, at: e.at, text: e.text, detail: e.detail },
      { id: 'b1', type: 'FAIL', chunk: '62.1', by: 'alex', session: 's1', at: '2026-10-27T09:00:00.000Z', text: 'node scripts/verify.mjs: tree leg red', detail: 'full output here' },
    );
    assert.equal(board.seq, 1);
  });
  it('ids climb and are never reused', () => {
    const { board } = fold([note('FACT', 'a'), note('FACT', 'b'), note('FACT', 'c')]);
    assert.deepEqual(board.entries.map((e) => e.id), ['b1', 'b2', 'b3']);
  });
  it('collapses whitespace so one note is one line', () => {
    const { board } = fold([note('OBSERVED', '  the   gate\n\twas red  ')]);
    assert.equal(board.entries[0].text, 'the gate was red');
  });
  it('is refused when malformed, with the reason', () => {
    const cases = [
      [note('NOPE', 'x'), /type/],
      [note('CLAIM', 'x'), /CLAIM.*claims\.json/],
      [note('FACT', 'x', { chunk: 'sixty-two' }), /chunk/],
      [note('FACT', '   '), /text/],
      [note('FACT', 'x', { by: '' }), /by/],
      [note('FACT', 'x', { session: '' }), /session/],
    ];
    for (const [n, re] of cases) assert.match(codec.noteProblem(n) ?? '', re);
    assert.equal(codec.noteProblem(note('FACT', 'fine')), null);
    assert.throws(() => codec.addNote(codec.emptyBoard(), note('NOPE', 'x'), T0), /type/);
  });
});

describe('the caps', () => {
  it('text is 100 characters, a PATCH 300', () => {
    assert.equal(codec.CAPS.text, 100);
    assert.equal(codec.CAPS.PATCH, 300);
    assert.equal(codec.capOf('FACT'), 100);
    assert.equal(codec.capOf('PATCH'), 300);
  });
  it('100 passes and 101 is refused for every type but PATCH', () => {
    for (const type of ['OBSERVED', 'FACT', 'FAIL']) {
      assert.equal(codec.noteProblem(note(type, 'x'.repeat(100))), null);
      assert.match(codec.noteProblem(note(type, 'x'.repeat(101))), /101 characters.*100.*--detail/);
    }
  });
  it('300 passes and 301 is refused for a PATCH', () => {
    assert.equal(codec.noteProblem(note('PATCH', 'x'.repeat(300))), null);
    assert.match(codec.noteProblem(note('PATCH', 'x'.repeat(301))), /301 characters.*300/);
  });
  it('is measured after whitespace collapses', () => {
    assert.equal(codec.noteProblem(note('FACT', `${'x'.repeat(100)}   \n  `)), null);
  });
  it('detail is unbounded', () => {
    const { board } = fold([note('FAIL', 'big log', { detail: 'line\n'.repeat(50_000) })]);
    assert.equal(board.entries[0].detail.length, 250_000);
  });
  it('a refused note changes nothing', () => {
    const before = fold([note('FACT', 'one')]).board;
    assert.throws(() => codec.addNote(before, note('FACT', 'x'.repeat(101)), T0), /101 characters/);
    assert.equal(before.entries.length, 1);
  });
});

describe('dedup', () => {
  it('two sessions writing the same FACT make one entry rendered (x2)', () => {
    const { board, outs } = fold([note('FACT', 'steer.mjs drains the notice board', { session: 's1' }), note('FACT', 'steer.mjs drains the notice board', { session: 's2', by: 'sam' })]);
    assert.equal(board.entries.length, 1);
    assert.equal(outs[1].outcome, 'duplicate');
    assert.equal(outs[1].entry.id, 'b1');
    assert.equal(board.entries[0].count, 2);
    assert.equal(codec.render(board.entries[0]), 'steer.mjs drains the notice board (x2)');
    assert.equal(board.seq, 1);
  });
  it('a third bumps to (x3); one entry renders bare', () => {
    const { board } = fold([note('FACT', 'same'), note('FACT', 'same'), note('FACT', 'same')]);
    assert.equal(codec.render(board.entries[0]), 'same (x3)');
    assert.equal(codec.render(fold([note('FACT', 'once')]).board.entries[0]), 'once');
    assert.equal(fold([note('FACT', 'once')]).board.entries[0].count, undefined);
  });
  it('exact means normalized: case, spacing and trailing punctuation do not make a new entry', () => {
    const { board } = fold([note('FACT', 'Steer reads the board.'), note('FACT', '  steer   reads the BOARD ')]);
    assert.equal(board.entries.length, 1);
    assert.equal(board.entries[0].count, 2);
  });
  it('the same text under another type is another entry', () => {
    const { board } = fold([note('FACT', 'gate is slow'), note('OBSERVED', 'gate is slow')]);
    assert.equal(board.entries.length, 2);
  });
  it('different text is another entry', () => {
    assert.equal(fold([note('FACT', 'a'), note('FACT', 'b')]).board.entries.length, 2);
  });
  it('a duplicate keeps the first entry, its author and its time', () => {
    const { board } = fold([note('FACT', 'same', { by: 'alex' }), note('FACT', 'same', { by: 'sam', session: 's2' })]);
    assert.equal(board.entries[0].by, 'alex');
    assert.equal(board.entries[0].at, '2026-10-27T09:00:00.000Z');
  });
  it('a detail on the duplicate fills a missing one and never overwrites', () => {
    const a = fold([note('FACT', 'same'), note('FACT', 'same', { detail: 'why' })]).board.entries[0];
    assert.equal(a.detail, 'why');
    const b = fold([note('FACT', 'same', { detail: 'first' }), note('FACT', 'same', { detail: 'second' })]).board.entries[0];
    assert.equal(b.detail, 'first');
  });
  describe('the key', () => {
    it('is file + symbol + error class + test name, lowercase, language-neutral', () => {
      assert.equal(codec.dedupKey('TypeError in scripts/claims.mjs: `pushClaims` is not a function'), 'scripts/claims.mjs|pushclaims|typeerror');
      assert.equal(codec.dedupKey('src/main.rs:42:7 panicked in `parse_header`; ENOENT'), 'src/main.rs|parse_header|enoent');
      assert.equal(codec.dedupKey('not ok 3 - claims race retries (lib/claims.py:88) AssertionError'), 'lib/claims.py|assertionerror|claims race retries');
      assert.equal(codec.dedupKey('Foo.java:10 NullPointerException in handle()'), 'foo.java|handle|nullpointerexception');
    });
    it('is null without a file, or with a file and nothing else', () => {
      assert.equal(codec.dedupKey('the gate was red'), null);
      assert.equal(codec.dedupKey('look at scripts/claims.mjs'), null);
      assert.equal(codec.dedupKey('TypeError somewhere'), null);
    });
    it('ignores a line and column, so the same failure moved down a line is the same failure', () => {
      assert.equal(codec.dedupKey('TypeError at scripts/a.mjs:10:3'), codec.dedupKey('TypeError at scripts/a.mjs:12:9'));
    });
    it('folds two FAILs worded differently into one (x2)', () => {
      const { board } = fold([
        note('FAIL', 'TypeError in scripts/claims.mjs: `pushClaims` is not a function', { session: 's1' }),
        note('FAIL', '`pushClaims` threw a TypeError (scripts/claims.mjs:200)', { session: 's2' }),
      ]);
      assert.equal(board.entries.length, 1);
      assert.equal(board.entries[0].count, 2);
    });
    it('does not fold two FAILs in the same file with different errors', () => {
      const { board } = fold([note('FAIL', 'TypeError in scripts/claims.mjs'), note('FAIL', 'RangeError in scripts/claims.mjs')]);
      assert.equal(board.entries.length, 2);
    });
    it('is for FAILs only: two FACTs about one file stay two', () => {
      const { board } = fold([note('FACT', 'scripts/claims.mjs exports `pushClaims`'), note('FACT', 'scripts/claims.mjs wraps `pushClaims` in update')]);
      assert.equal(board.entries.length, 2);
    });
  });
});

describe('a PATCH', () => {
  it('is replaced by its author next for the same chunk', () => {
    const { board, outs } = fold([note('PATCH', 'codec + tests'), note('PATCH', 'codec, tests, write path')]);
    assert.equal(outs[1].outcome, 'replaced');
    assert.equal(board.entries.length, 2, 'append-only: the old one stays in the history');
    assert.equal(board.entries[1].replaces, 'b1');
    assert.deepEqual(codec.live(board.entries).map((e) => e.id), ['b2']);
  });
  it("is not replaced by another session's PATCH for the same chunk", () => {
    const { board } = fold([note('PATCH', 'mine', { session: 's1' }), note('PATCH', 'theirs', { session: 's2', by: 'sam' })]);
    assert.deepEqual(codec.live(board.entries).map((e) => e.id), ['b1', 'b2']);
    assert.equal(board.entries[1].replaces, undefined);
  });
  it("is not replaced by the author's PATCH for another chunk", () => {
    const { board } = fold([note('PATCH', 'one'), note('PATCH', 'two', { chunk: '62.2' })]);
    assert.deepEqual(codec.live(board.entries).map((e) => e.id), ['b1', 'b2']);
  });
  it('replaces only the live one: three in a row leave one live', () => {
    const { board } = fold([note('PATCH', 'v1'), note('PATCH', 'v2'), note('PATCH', 'v3')]);
    assert.deepEqual(codec.live(board.entries).map((e) => e.id), ['b3']);
    assert.equal(board.entries[2].replaces, 'b2');
  });
  it('never dedups: the same PATCH text from the same author is a replacement, not (x2)', () => {
    const { board, outs } = fold([note('PATCH', 'same'), note('PATCH', 'same')]);
    assert.equal(outs[1].outcome, 'replaced');
    assert.equal(codec.live(board.entries)[0].count, undefined);
  });
  it('renders without a count', () => {
    assert.equal(codec.render(fold([note('PATCH', 'x')]).board.entries[0]), 'x');
  });
});

describe('a FAIL naming the chunk', () => {
  it('marks its latest PATCH invalidated', () => {
    const { board, outs } = fold([note('PATCH', 'landed the codec'), note('FAIL', 'gate red after the rebase', { session: 's2', by: 'sam' })]);
    assert.equal(board.entries[0].invalidated, true);
    assert.equal(board.entries[1].invalidates, 'b1');
    assert.equal(outs[1].outcome, 'added');
    assert.equal(codec.render(board.entries[0]), 'landed the codec [invalidated]');
  });
  it('marks only the latest: a replaced PATCH is history, not live', () => {
    const { board } = fold([note('PATCH', 'v1'), note('PATCH', 'v2'), note('FAIL', 'red')]);
    assert.equal(board.entries[0].invalidated, undefined);
    assert.equal(board.entries[1].invalidated, true);
  });
  it('marks the latest PATCH of that chunk by any author', () => {
    const { board } = fold([note('PATCH', 'sam work', { session: 's2', by: 'sam' }), note('FAIL', 'red', { session: 's1' })]);
    assert.equal(board.entries[0].invalidated, true);
  });
  it('leaves a PATCH for another chunk alone', () => {
    const { board } = fold([note('PATCH', 'other', { chunk: '62.2' }), note('FAIL', 'red')]);
    assert.equal(board.entries[0].invalidated, undefined);
    assert.equal(board.entries[1].invalidates, undefined);
  });
  it('with no PATCH for the chunk is just a FAIL', () => {
    const { board } = fold([note('FAIL', 'red')]);
    assert.equal(board.entries[0].invalidates, undefined);
  });
  it('does not invalidate twice: a second FAIL finds the PATCH already invalidated', () => {
    const { board } = fold([note('PATCH', 'p'), note('FAIL', 'first red'), note('FAIL', 'second red')]);
    assert.equal(board.entries[1].invalidates, 'b1');
    assert.equal(board.entries[2].invalidates, undefined);
  });
  it('a dedup duplicate FAIL still invalidates a PATCH that landed since', () => {
    const { board, outs } = fold([note('FAIL', 'red'), note('PATCH', 'fixed it'), note('FAIL', 'red', { session: 's2' })]);
    assert.equal(outs[2].outcome, 'duplicate');
    assert.equal(board.entries[1].invalidated, true);
    assert.equal(board.entries[0].count, 2);
  });
  it("a replacement PATCH is live again: the author's next after a FAIL is not invalidated", () => {
    const { board } = fold([note('PATCH', 'v1'), note('FAIL', 'red'), note('PATCH', 'v2 fixed')]);
    assert.equal(board.entries[0].invalidated, true);
    assert.equal(board.entries[2].invalidated, undefined);
    assert.deepEqual(codec.live(board.entries).map((e) => e.id), ['b2', 'b3']);
  });
});

describe('merging onto a newer tip (a lost race, redone)', () => {
  it('a note applied to a board that moved keeps every entry already there', () => {
    const mine = fold([note('FACT', 'mine')]).board;
    const theirs = codec.addNote(mine, note('FACT', 'theirs', { session: 's2' }), T0 + 5000).board;
    const merged = codec.addNote(theirs, note('FACT', 'late', { session: 's3' }), T0 + 9000).board;
    assert.deepEqual(merged.entries.map((e) => e.text), ['mine', 'theirs', 'late']);
    assert.deepEqual(merged.entries.map((e) => e.id), ['b1', 'b2', 'b3']);
  });
  it('addNote does not mutate its input', () => {
    const b = fold([note('PATCH', 'p')]).board;
    const frozen = JSON.stringify(b);
    codec.addNote(b, note('FAIL', 'red'), T0);
    assert.equal(JSON.stringify(b), frozen);
  });
});
