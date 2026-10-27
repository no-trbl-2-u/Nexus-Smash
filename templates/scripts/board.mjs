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
// The cursor is the last entry id a session has seen, one file per session, .nexus/board-cursor/<session>, at the
// primary checkout (untracked, shared by its worktrees; written to a temp file and renamed, so two writers never lose
// each other's). It is a convenience: a file that is missing or unreadable reads as "nothing seen yet", and a snapshot
// then shows the whole board once. With no session id (no NEXUS_SESSION, no Claude Code session, no --session) there is
// no one to keep a cursor for: snapshot prints everything, keeps nothing, and says to pass --session.
// A note's text is data: control characters (terminal escapes) are stripped before anything prints.
//
// Flags: --json, --all (read), --session <id>; `--` ends the flags, so grep can search for a word that starts with `--`.
// Environment: NEXUS_SESSION (this session's id; else the Claude Code session's first 8 characters), NEXUS_CLAIMS_REMOTE.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { claimsSession, fetchBoard } from './claims.mjs';
import { live, render } from './claims-codec.mjs';
import { primaryRoot } from './owner.mjs';

export const CURSOR_DIR = path.join('.nexus', 'board-cursor');
export const MAX_DEPTH = 32;
const SESSION = /^[A-Za-z0-9][\w.~-]{0,63}$/;

/** Text as it may print: control characters other than newline and tab (terminal escapes) removed. */
export const clean = (s) => String(s).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
/** JSON.stringify's text, with the DEL and C1 controls it leaves raw written as escapes too. */
export const safeJson = (v) => JSON.stringify(v, null, 2).replace(/[\x7f-\x9f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

/** This session's id: NEXUS_SESSION, else the Claude Code session's first 8; '' when neither is set (a pid is no session). */
export const sessionOf = (env) => env.NEXUS_SESSION || (env.CLAUDE_CODE_SESSION_ID ?? '').slice(0, 8);

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
  let depth = 0;
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
      if (++depth > MAX_DEPTH) throw new Error(`grep: nesting deeper than ${MAX_DEPTH} parentheses.`);
      const inner = or();
      depth--;
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
export function unfold(e, entries = []) {
  const next = entries.find((x) => x.replaces === e.id);
  const links = [
    e.count > 1 ? `seen ${e.count} times` : '',
    e.chunks?.length ? `chunks ${e.chunks.join(', ')}` : '',
    e.replaces ? `replaces ${e.replaces}` : '',
    next ? `replaced by ${next.id}` : '',
    e.invalidates ? `invalidates ${e.invalidates}` : '',
    e.invalidated ? 'invalidated by a later FAIL' : '',
  ].filter(Boolean);
  return [line(e), `${e.by} · session ${e.session} · ${e.at}${links.length ? ` · ${links.join(' · ')}` : ''}`, '', e.detail ? e.detail : '(no detail)'].join('\n');
}

// --- the cursor file --------------------------------------------------------------------------------------------------

/** A session's cursor (the last id number it has seen); 0 when its file is missing or unreadable. */
export function readCursor(root, session) {
  try {
    const n = Number.parseInt(fs.readFileSync(path.join(root, CURSOR_DIR, session), 'utf8'), 10);
    return n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Move one session's cursor (never backwards). One file per session, written to a temp file and renamed into place. */
export function writeCursor(root, session, n) {
  if (!SESSION.test(session)) throw new Error(`board: "${session}" is not a usable session id.`);
  const dir = path.join(root, CURSOR_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${session}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`);
  fs.writeFileSync(tmp, `${Math.max(readCursor(root, session), n)}\n`);
  // Windows refuses a rename onto a file another process has open for a moment: wait and try again.
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(tmp, path.join(dir, session));
      return;
    } catch (e) {
      if (i >= 20) {
        fs.rmSync(tmp, { force: true });
        throw e;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10 + i * 5);
    }
  }
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
  // Our flags come before a `--`; everything else, and all that follows a `--`, is the command's arguments.
  const dd = rest.indexOf('--');
  const head = dd >= 0 ? rest.slice(0, dd) : rest;
  const tail = dd >= 0 ? rest.slice(dd + 1) : [];
  const si = head.indexOf('--session');
  let session = '';
  if (si >= 0) {
    const v = head[si + 1];
    if (!v || v.startsWith('--')) throw new Error('board: --session needs a session id.');
    session = claimsSession(v);
    head.splice(si, 2);
  }
  const flags = new Set(head.filter((a) => a === '--json' || a === '--all'));
  const args = [...head.filter((a) => a !== '--json' && a !== '--all'), ...tail];
  const json = flags.has('--json');
  const emit = (value, lines, empty) => out(json ? safeJson(value) : lines.length ? clean(lines.join('\n')) : empty);
  switch (cmd) {
    case 'snapshot': {
      const me = session || sessionOf(env);
      if (me && !SESSION.test(me)) throw new Error(`board: "${me}" is not a usable session id.`);
      const dir = me ? root(cwd) : '';
      const s = snapshot(fetch(cwd), me ? readCursor(dir, me) : 0);
      emit({ session: me, entries: s.entries, cursor: s.cursor }, s.entries.map(line), 'board: nothing new.');
      if (me) writeCursor(dir, me, s.cursor);
      else err('board: no session id; pass --session <id> (or set NEXUS_SESSION) to keep a cursor. Printed everything, kept none.');
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
      const all = fetch(cwd);
      const e = find(all, args[0]);
      if (!e) throw new Error(`board: no entry ${clean(args[0])}.`);
      emit(e, [unfold(e, all.entries)]);
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
