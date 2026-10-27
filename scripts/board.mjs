#!/usr/bin/env node
// scripts/board.mjs: read the typed board (spec 62), what sessions on one spec learned.
//
// board.json lives on the `claims` branch beside claims.json (scripts/claims-codec.mjs holds its rules, scripts/claims.mjs
// the compare-and-swap that writes it). This script only reads it:
//
//   node scripts/board.mjs snapshot [--session <id>]   what is new since this session's last snapshot, FAIL first;
//                                                      then the cursor moves, so the next one shows only what came after
//   node scripts/board.mjs read [--all]                every live entry, oldest first (--all adds the replaced PATCHes)
//   node scripts/board.mjs grep <expr>                 the full history, entries matching a boolean expression
//   node scripts/board.mjs unfold <id>                 one entry in full, with its detail
//
// A grep expression is terms joined by `&` (and) and `|` (or), grouped with parentheses; `&` binds tighter than `|`. A
// term is a word or a "quoted phrase", matched without regard to case against an entry's type, chunk, author, session,
// text and detail: `grep 'FAIL & (62.1 | 62.2)'`, `grep '"claims.json" & FAIL'`. A malformed expression is an error, never a guess.
//
// The cursor is the last entry id a session has seen, kept per session in .nexus/board-cursor.json at the primary
// checkout (untracked, shared by its worktrees). It is a convenience: a cursor file that is missing or unreadable
// reads as "nothing seen yet", and a snapshot then shows the whole board once.
//
// Environment: NEXUS_SESSION (this session's id; else the Claude Code session, as claims.mjs), NEXUS_CLAIMS_REMOTE.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { claimsSession, fetchBoard, sessionId } from './claims.mjs';
import { live, render } from './claims-codec.mjs';
import { primaryRoot } from './owner.mjs';

export const CURSOR_FILE = path.join('.nexus', 'board-cursor.json');

/** The number inside an entry id (`b12` is 12); 0 for anything else. */
export const numOf = (id) => Number(/^b(\d+)$/.exec(String(id))?.[1]) || 0;

/** One entry as a line: `b12 FAIL 62.1 alex: <text> (x2) [invalidated]`. */
export function line(e) {
  return `${e.id} ${e.type} ${e.chunk} ${e.by}: ${render(e)}`;
}

/**
 * What a reader with `cursor` (the last id number seen) sees of `board`: { entries, cursor }. The live entries newer
 * than the cursor, the FAILs first (newest first), then the rest (newest first); `cursor` is where it moves to, the
 * board's last id, whether or not anything was shown. Pure.
 */
export function snapshot(board, cursor = 0) {
  const fresh = live(board.entries).filter((e) => numOf(e.id) > cursor);
  const newest = (a, b) => numOf(b.id) - numOf(a.id);
  const fails = fresh.filter((e) => e.type === 'FAIL').sort(newest);
  const rest = fresh.filter((e) => e.type !== 'FAIL').sort(newest);
  const top = Math.max(cursor, board.seq ?? 0, ...board.entries.map((e) => numOf(e.id)));
  return { entries: [...fails, ...rest], cursor: top };
}

// --- grep: a small boolean expression over terms ----------------------------------------------------------------------

/** The expression's tokens: { t: 'term'|'and'|'or'|'open'|'close', v, at } (at is the 1-based column). Throws on a bad quote. */
export function tokens(expr) {
  const out = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (/\s/.test(c)) i++;
    else if (c === '&') out.push({ t: 'and', at: ++i });
    else if (c === '|') out.push({ t: 'or', at: ++i });
    else if (c === '(') out.push({ t: 'open', at: ++i });
    else if (c === ')') out.push({ t: 'close', at: ++i });
    else if (c === '"') {
      const end = expr.indexOf('"', i + 1);
      if (end < 0) throw new Error(`grep: the quote opened at column ${i + 1} is never closed.`);
      if (end === i + 1) throw new Error(`grep: an empty "" at column ${i + 1} matches everything; leave it out.`);
      out.push({ t: 'term', v: expr.slice(i + 1, end), at: i + 1 });
      i = end + 1;
    } else {
      let j = i;
      while (j < expr.length && !/[\s&|()"]/.test(expr[j])) j++;
      out.push({ t: 'term', v: expr.slice(i, j), at: i + 1 });
      i = j;
    }
  }
  return out;
}

const SHOWN = { term: 'a term', and: '"&"', or: '"|"', open: '"("', close: '")"', end: 'the end of the expression' };

/**
 * Parse `expr` into a tree: { term } | { and: [..] } | { or: [..] }. `&` binds tighter than `|`; parentheses group.
 * Throws an Error that names what was wrong and where (`grep: ...`) for an empty expression, a dangling or doubled
 * operator, a missing operator between terms, or unbalanced parentheses. Pure.
 */
export function parseExpr(expr) {
  const toks = tokens(String(expr ?? ''));
  if (!toks.length) throw new Error('grep: give an expression, e.g. grep \'FAIL & (62.1 | 62.2)\'.');
  let p = 0;
  const peek = () => toks[p];
  const bad = (want) => {
    const got = peek();
    return new Error(`grep: expected ${want} at ${got ? `column ${got.at}, found ${SHOWN[got.t]}` : 'the end of the expression'}.`);
  };
  const or = () => {
    const parts = [and()];
    while (peek()?.t === 'or') {
      p++;
      parts.push(and());
    }
    return parts.length === 1 ? parts[0] : { or: parts };
  };
  const and = () => {
    const parts = [atom()];
    while (peek()?.t === 'and') {
      p++;
      parts.push(atom());
    }
    return parts.length === 1 ? parts[0] : { and: parts };
  };
  const atom = () => {
    const tok = peek();
    if (tok?.t === 'term') {
      p++;
      return { term: tok.v };
    }
    if (tok?.t === 'open') {
      p++;
      const inner = or();
      if (peek()?.t !== 'close') throw new Error(`grep: the "(" at column ${tok.at} is never closed.`);
      p++;
      return inner;
    }
    throw bad('a term or "("');
  };
  const tree = or();
  if (p < toks.length) {
    const got = peek();
    if (got.t === 'close') throw new Error(`grep: the ")" at column ${got.at} closes nothing.`);
    throw bad('"&" or "|" between terms');
  }
  return tree;
}

/** Whether a parsed expression holds for `text` (compared without regard to case). */
export function holds(tree, text) {
  if ('term' in tree) return text.includes(tree.term.toLowerCase());
  if ('and' in tree) return tree.and.every((t) => holds(t, text));
  return tree.or.some((t) => holds(t, text));
}

/** What grep searches in an entry: its type, chunk (and the chunks a duplicate came from), author, session, text and detail. */
export const haystack = (e) => [e.type, e.chunk, ...(e.chunks ?? []), e.by, e.session, e.text, e.detail].filter(Boolean).join('\n').toLowerCase();

/** The entries of the full history (replaced ones too) that match `expr`, oldest first. Throws on a malformed expression. */
export function grep(board, expr) {
  const tree = parseExpr(expr);
  return board.entries.filter((e) => holds(tree, haystack(e)));
}

// --- unfold -----------------------------------------------------------------------------------------------------------

/** The entry with this id (`b12` or `12`), or undefined. */
export function find(board, id) {
  const want = /^\d+$/.test(String(id)) ? `b${id}` : String(id);
  return board.entries.find((e) => e.id === want);
}

/** One entry in full: its line, who and when, how it links to others, and the detail (or a note that it has none). */
export function unfold(e) {
  const links = [
    e.count > 1 ? `seen ${e.count} times` : '',
    e.chunks?.length ? `chunks ${e.chunks.join(', ')}` : '',
    e.replaces ? `replaces ${e.replaces}` : '',
    e.invalidates ? `invalidates ${e.invalidates}` : '',
    e.invalidated ? 'invalidated by a later FAIL' : '',
  ].filter(Boolean);
  return [line(e), `${e.by} · session ${e.session} · ${e.at}${links.length ? ` · ${links.join(' · ')}` : ''}`, '', e.detail ? e.detail : '(no detail)'].join('\n');
}

// --- the cursor file --------------------------------------------------------------------------------------------------

/** The per-session cursors ({ <session>: <last id number seen> }); {} when the file is missing or unreadable. */
export function readCursors(root) {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(root, CURSOR_FILE), 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** Move one session's cursor (never backwards); the other sessions' cursors stay. */
export function writeCursor(root, session, n) {
  const all = readCursors(root);
  all[session] = Math.max(Number(all[session]) || 0, n);
  const file = path.join(root, CURSOR_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(all, null, 2)}\n`);
}

// --- the CLI ----------------------------------------------------------------------------------------------------------

const USAGE = 'usage: board.mjs snapshot [--session <id>] | read [--all] | grep <expr> | unfold <id>   (each: [--json])';

/**
 * Run a command; returns the exit code. `fetch(cwd)` and `root(cwd)` are seams for tests: the board (default: the claims
 * branch on origin) and the checkout the cursor file lives in (default: the primary checkout).
 */
export function main(argv, { cwd = process.cwd(), env = process.env, out = console.log, err = console.error, fetch = (c) => fetchBoard(c).board, root = primaryRoot } = {}) {
  const rest = [...argv];
  const cmd = rest.shift();
  const si = rest.indexOf('--session');
  const session = si >= 0 ? claimsSession(rest.splice(si, 2)[1] ?? '') : '';
  const flags = new Set(rest.filter((a) => a.startsWith('--')));
  const args = rest.filter((a) => !a.startsWith('--'));
  const json = flags.has('--json');
  const emit = (value, lines, empty) => out(json ? JSON.stringify(value, null, 2) : lines.length ? lines.join('\n') : empty);
  switch (cmd) {
    case 'snapshot': {
      const me = session || sessionId(env);
      const dir = root(cwd);
      const s = snapshot(fetch(cwd), Number(readCursors(dir)[me]) || 0);
      emit({ session: me, entries: s.entries, cursor: s.cursor }, s.entries.map(line), 'board: nothing new.');
      writeCursor(dir, me, s.cursor);
      return 0;
    }
    case 'read': {
      const board = fetch(cwd);
      const entries = flags.has('--all') ? board.entries : live(board.entries);
      emit(entries, entries.map(line), 'board: empty.');
      return 0;
    }
    case 'grep': {
      const expr = args.join(' ');
      const hits = grep(fetch(cwd), expr);
      emit(hits, hits.map(line), 'board: no matches.');
      return 0;
    }
    case 'unfold': {
      if (args.length !== 1) throw new Error('board: unfold needs one <id> (e.g. b12).');
      const e = find(fetch(cwd), args[0]);
      if (!e) throw new Error(`board: no entry ${args[0]}.`);
      emit(e, [unfold(e)]);
      return 0;
    }
    default:
      err(USAGE);
      return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const argv = process.argv.slice(2);
  let code = 1;
  try {
    code = main(argv);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (argv.includes('--json')) console.log(JSON.stringify({ ok: false, error: msg }));
    else console.error(msg);
  }
  process.exit(code);
}
