// board.mjs, the reading half: snapshot ordering and the cursor, grep's boolean expressions, unfold. Pure: the board is
// built with the codec and handed to main() through its seams, the cursor file lives in a temp folder, and nothing
// touches git. board-run.test.mjs runs the CLI over a real claims branch. node:test, no deps.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import * as board from '../board.mjs';
import * as codec from '../claims-codec.mjs';

const T0 = Date.parse('2026-10-27T09:00:00Z');
const note = (type, text, extra = {}) => ({ type, chunk: '62.1', by: 'alex', session: 's1', text, ...extra });
function fold(notes, b = codec.emptyBoard(), start = 0) {
  return notes.reduce((acc, n, i) => codec.addNote(acc, n, T0 + (start + i) * 60_000).board, b);
}

const dirs = [];
after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-board-read-'));
  dirs.push(d);
  return d;
};

/** main() against a fixed board, capturing stdout/stderr; returns { code, out, err }. */
function run(argv, b, root, env = { NEXUS_SESSION: 's1' }) {
  const out = [];
  const err = [];
  const code = board.main(argv, { env, out: (s) => out.push(s), err: (s) => err.push(s), fetch: () => b, root: () => root });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

const B = fold([
  note('FACT', 'steer.mjs reads the deny reason'),
  note('FAIL', 'node scripts/verify.mjs: links leg red at README.md:10'),
  note('OBSERVED', 'the claims branch holds board.json', { chunk: '62.2' }),
  note('FAIL', 'npm test: board-codec.test.mjs fails on dedupKey', { chunk: '62.2', detail: 'AssertionError: expected null' }),
  note('PATCH', 'codec adds addNote and the caps'),
]);

describe('snapshot', () => {
  it('prints FAILs first, newest first, then the rest newest first', () => {
    const s = board.snapshot(B, 0);
    assert.deepEqual(s.entries.map((e) => e.id), ['b4', 'b2', 'b5', 'b3', 'b1']);
  });
  it('prints only entries newer than the cursor and moves the cursor to the last id', () => {
    const s = board.snapshot(B, 3);
    assert.deepEqual(s.entries.map((e) => e.id), ['b4', 'b5']);
    assert.equal(s.cursor, 5);
  });
  it('shows nothing past the cursor, and never moves it back', () => {
    const s = board.snapshot(B, 9);
    assert.deepEqual(s.entries, []);
    assert.equal(s.cursor, 9);
  });
  it('hides a PATCH its author replaced, and keeps a duplicate where it first stood', () => {
    const b = fold([note('PATCH', 'first take'), note('FACT', 'a'), note('PATCH', 'second take'), note('FACT', 'a')], codec.emptyBoard());
    const ids = board.snapshot(b, 0).entries.map((e) => e.id);
    assert.deepEqual(ids, ['b3', 'b2']);
    assert.ok(!ids.includes('b1'), 'the replaced PATCH is gone');
    assert.equal(b.entries.length, 3, 'the duplicate FACT added no entry');
  });
  it('renders a count and an invalidated PATCH on the line', () => {
    const b = fold([note('PATCH', 'done'), note('FACT', 'same'), note('FACT', 'same'), note('FAIL', 'gate red')]);
    const lines = board.snapshot(b, 0).entries.map(board.line);
    assert.ok(lines.some((l) => /same \(x2\)/.test(l)));
    assert.ok(lines.some((l) => /done \[invalidated\]/.test(l)));
  });
});

describe('the cursor per session, over the CLI', () => {
  it('the second snapshot shows only what came after, and sessions do not share a cursor', () => {
    const root = tmp();
    const first = run(['snapshot'], B, root);
    assert.equal(first.code, 0);
    assert.match(first.out.split('\n')[0], /^b4 FAIL 62\.2 alex:/);
    assert.equal(first.out.split('\n').length, 5);
    assert.equal(run(['snapshot'], B, root).out, 'board: nothing new.');
    const later = fold([note('FAIL', 'second failure in README.md `link`')], B, 5);
    assert.deepEqual(run(['snapshot'], later, root).out.split('\n').map((l) => l.split(' ')[0]), ['b6']);
    // another session starts from the top
    assert.equal(run(['snapshot'], later, root, { NEXUS_SESSION: 's2' }).out.split('\n').length, 6);
    assert.deepEqual([board.readCursor(root, 's1'), board.readCursor(root, 's2')], [6, 6]);
  });
  it('--session names the cursor; an unreadable cursor file reads as nothing seen', () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, board.CURSOR_DIR), { recursive: true });
    fs.writeFileSync(path.join(root, board.CURSOR_DIR, 'zed'), 'not a number');
    assert.equal(run(['snapshot', '--session', 'zed'], B, root).out.split('\n').length, 5);
    assert.equal(board.readCursor(root, 'zed'), 5);
  });
  it('concurrent writers lose no cursor (one file per session)', async () => {
    const root = tmp();
    const mod = new URL('../board.mjs', import.meta.url).href;
    const script = `import(${JSON.stringify(mod)}).then((b) => { for (let i = 0; i < 150; i++) b.writeCursor(process.argv[1], process.argv[2] + i, i + 1); })`;
    const kids = ['a', 'b', 'c'].map((p) => spawn(process.execPath, ['-e', script, root, p], { stdio: 'ignore' }));
    await Promise.all(kids.map((k) => new Promise((res) => k.on('exit', res))));
    assert.equal(fs.readdirSync(path.join(root, board.CURSOR_DIR)).length, 450);
    assert.equal(board.readCursor(root, 'c149'), 150);
  });
  it('without a session id nothing is persisted, everything prints, and it says to pass --session', () => {
    const root = tmp();
    const r = run(['snapshot'], B, root, {});
    assert.equal(r.code, 0);
    assert.equal(r.out.split('\n').length, 5);
    assert.match(r.err, /no session id; pass --session/);
    assert.equal(run(['snapshot'], B, root, {}).out.split('\n').length, 5);
    assert.equal(fs.existsSync(path.join(root, board.CURSOR_DIR)), false);
  });
  it('CLAUDE_CODE_SESSION_ID counts as a session (its first 8)', () => {
    const root = tmp();
    run(['snapshot'], B, root, { CLAUDE_CODE_SESSION_ID: '12345678-aaaa-bbbb-cccc-1234567890ab' });
    assert.equal(board.readCursor(root, '12345678'), 5);
  });
  it('--session needs a value that is not a flag, and one usable as a file name', () => {
    assert.throws(() => run(['snapshot', '--session', '--json'], B, tmp()), /--session needs a session id/);
    assert.throws(() => run(['snapshot', '--session'], B, tmp()), /--session needs a session id/);
    assert.throws(() => run(['snapshot', '--session', '../x'], B, tmp()), /not a usable session id/);
  });
  it('--json carries the entries and the new cursor', () => {
    const j = JSON.parse(run(['snapshot', '--json'], B, tmp()).out);
    assert.equal(j.cursor, 5);
    assert.equal(j.entries[0].id, 'b4');
  });
});

describe('read', () => {
  it('prints live entries oldest first; --all adds the replaced history', () => {
    const b = fold([note('PATCH', 'one'), note('PATCH', 'two')]);
    assert.deepEqual(run(['read'], b, tmp()).out.split('\n').map((l) => l.split(' ')[0]), ['b2']);
    assert.deepEqual(run(['read', '--all'], b, tmp()).out.split('\n').map((l) => l.split(' ')[0]), ['b1', 'b2']);
  });
  it('does not move the cursor', () => {
    const root = tmp();
    run(['read', '--all'], B, root);
    assert.equal(fs.existsSync(path.join(root, board.CURSOR_DIR)), false);
  });
});

describe('grep expressions', () => {
  const ids = (expr) => board.grep(B, expr).map((e) => e.id);
  it('matches one term without regard to case, in the type, chunk, text or detail', () => {
    assert.deepEqual(ids('fail'), ['b2', 'b4']);
    assert.deepEqual(ids('62.2'), ['b3', 'b4']);
    assert.deepEqual(ids('assertionerror'), ['b4']);
  });
  it('& needs both, | needs either', () => {
    assert.deepEqual(ids('FAIL & 62.2'), ['b4']);
    assert.deepEqual(ids('steer | PATCH'), ['b1', 'b5']);
  });
  it('& binds tighter than |', () => {
    // FACT | (FAIL & 62.2), not (FACT | FAIL) & 62.2
    assert.deepEqual(ids('FACT | FAIL & 62.2'), ['b1', 'b4']);
    assert.deepEqual(board.parseExpr('a | b & c'), { or: [{ term: 'a' }, { and: [{ term: 'b' }, { term: 'c' }] }] });
  });
  it('parentheses override the precedence and nest', () => {
    assert.deepEqual(ids('(FACT | FAIL) & 62.2'), ['b4']);
    assert.deepEqual(ids('((FACT | OBSERVED) & (62.1 | 62.2))'), ['b1', 'b3']);
  });
  it('a quoted phrase is one term, with spaces and operators inside', () => {
    assert.deepEqual(ids('"deny reason"'), ['b1']);
    assert.deepEqual(ids('"verify.mjs: links"'), ['b2']);
    assert.deepEqual(board.parseExpr('"a & b"'), { term: 'a & b' });
  });
  it('searches the full history, replaced entries included', () => {
    const b = fold([note('PATCH', 'old take'), note('PATCH', 'new take')]);
    assert.deepEqual(board.grep(b, 'take').map((e) => e.id), ['b1', 'b2']);
  });
  it('joins separate arguments with a space, so an unquoted expression works', () => {
    assert.deepEqual(run(['grep', 'FAIL', '&', '62.2'], B, tmp()).out.split('\n').map((l) => l.split(' ')[0]), ['b4']);
    assert.equal(run(['grep', 'nothinghere'], B, tmp()).out, 'board: no matches.');
  });
});

describe('malformed grep expressions fail with a clear message', () => {
  const msg = (expr) => {
    try {
      board.parseExpr(expr);
    } catch (e) {
      return e.message;
    }
    return null;
  };
  it('an empty expression', () => {
    assert.match(msg(''), /^grep: give an expression/);
    assert.match(msg('   '), /^grep: give an expression/);
  });
  it('a dangling or doubled operator', () => {
    assert.match(msg('FAIL &'), /expected a term or "\(" at the end of the expression/);
    assert.match(msg('| FAIL'), /expected a term or "\(" at column 1, found "\|"/);
    assert.match(msg('FAIL & | 62.1'), /expected a term or "\(" at column 8, found "\|"/);
  });
  it('two terms with no operator between them', () => {
    assert.match(msg('FAIL 62.1'), /expected "&" or "\|" between terms at column 6, found a term/);
    assert.match(msg('(a) (b)'), /expected "&" or "\|" between terms at column 5, found "\("/);
  });
  it('unbalanced parentheses', () => {
    assert.match(msg('(FAIL & 62.1'), /the "\(" at column 1 is never closed/);
    assert.match(msg('FAIL)'), /the "\)" at column 5 closes nothing/);
    assert.match(msg('()'), /expected a term or "\(" at column 2, found "\)"/);
  });
  it('a quote never closed, or empty', () => {
    assert.match(msg('"abc'), /the quote opened at column 1 is never closed/);
    assert.match(msg('a & ""'), /an empty "" at column 5/);
  });
  it('through the CLI it throws the same message and touches no cursor', () => {
    const root = tmp();
    assert.throws(() => run(['grep', 'FAIL &'], B, root), /^Error: grep: expected a term/);
    assert.equal(fs.existsSync(path.join(root, board.CURSOR_DIR)), false);
  });
});

describe('grep takes the whole expression', () => {
  it('keeps --words that are not our flags, and -- ends the flags', () => {
    const b = fold([note('FACT', 'run it with --force and --json')]);
    assert.equal(run(['grep', '--force'], b, tmp()).out.split(' ')[0], 'b1');
    assert.equal(run(['grep', '--', '--json'], b, tmp()).out.split(' ')[0], 'b1');
    assert.equal(run(['grep', '--force', '&', 'FACT'], b, tmp()).out.split(' ')[0], 'b1');
    assert.ok(Array.isArray(JSON.parse(run(['grep', '--json', 'FACT'], b, tmp()).out)));
  });
  it('caps nesting with a clear error, not a RangeError', () => {
    const deep = (n) => '('.repeat(n) + 'a' + ')'.repeat(n);
    assert.doesNotThrow(() => board.parseExpr(deep(20)));
    assert.throws(() => board.parseExpr(deep(100000)), /^Error: grep: nesting deeper than 32/);
  });
});

describe('terminal escapes in notes', () => {
  const evil = fold([note('FACT', 'a\x1b[2Jb\x1b]0;pwned\x07c\x7fd\u009be', { detail: 'x\x1b[31mred\ttab\nline' })]);
  const plain = (s) => !/[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(s);
  it('are stripped from every text output, tabs and newlines kept', () => {
    for (const argv of [['snapshot'], ['read'], ['grep', 'a'], ['unfold', 'b1']]) assert.ok(plain(run(argv, evil, tmp()).out), argv[0]);
    assert.match(run(['unfold', 'b1'], evil, tmp()).out, /red\ttab\nline/);
  });
  it('JSON output stays valid and escaped', () => {
    const out = run(['read', '--json'], evil, tmp()).out;
    assert.ok(plain(out));
    assert.match(out, /\\u001b/);
  });
});

describe('unfold', () => {
  it('says which entry replaced a PATCH', () => {
    const b = fold([note('PATCH', 'one'), note('PATCH', 'two')]);
    assert.match(run(['unfold', 'b1'], b, tmp()).out, /replaced by b2/);
    assert.doesNotMatch(run(['unfold', 'b2'], b, tmp()).out, /replaced by/);
  });
  it('prints the line, who and when, and the detail in full', () => {
    const out = run(['unfold', 'b4'], B, tmp());
    assert.equal(out.code, 0);
    const [head, meta, blank, ...detail] = out.out.split('\n');
    assert.match(head, /^b4 FAIL 62\.2 alex: npm test: board-codec/);
    assert.match(meta, /^alex · session s1 · 2026-10-27T09:03:00\.000Z$/);
    assert.equal(blank, '');
    assert.equal(detail.join('\n'), 'AssertionError: expected null');
  });
  it('says so when there is no detail, takes a bare number, and shows how entries link', () => {
    assert.match(run(['unfold', '1'], B, tmp()).out, /\(no detail\)$/);
    const b = fold([note('PATCH', 'done'), note('FACT', 'x'), note('FACT', 'x', { chunk: '62.2' }), note('FAIL', 'gate red')]);
    assert.match(board.unfold(b.entries[1]), /seen 2 times · chunks 62\.1, 62\.2/);
    assert.match(board.unfold(b.entries[0]), /invalidated by a later FAIL/);
    assert.match(board.unfold(b.entries[2]), /invalidates b1/);
  });
  it('an unknown id or a missing one is an error', () => {
    assert.throws(() => run(['unfold', 'b99'], B, tmp()), /board: no entry b99\./);
    assert.throws(() => run(['unfold'], B, tmp()), /unfold needs one <id>/);
  });
});

describe('usage', () => {
  it('an unknown command prints the usage and exits 2', () => {
    const r = run(['frobnicate'], B, tmp());
    assert.equal(r.code, 2);
    assert.match(r.err, /^usage: board\.mjs snapshot/);
  });
});
