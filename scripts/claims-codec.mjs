// scripts/claims-codec.mjs: the rules of the `claims` branch's claims.json, which maps a chunk id to
//   "<who>|<ip>|<host>|<ISO time>|s:<session>[~<star>][|pr:<n>][|held:<login>][|b:<base>]"
// (~<star>: the session's ledger star name, when it has one; a session is matched by its id alone, never its star)
// scripts/claims.mjs (a loop's claims, over git) imports it, and so can anything else that claims over another
// transport (a team bot over the host's API, the local GUI), so every claimant obeys exactly a loop's rules: a claim
// lives 24 h, a PR's claim lives until it merges, a held claim never goes stale, a spec and its chunks exclude each
// other across claimants, a privileged claim is only the owner's to take over, and `force` is only the owner's.
//
// Plain JavaScript, no Node built-ins, no I/O, no clock beyond state's and decide's default `now`: safe in a Worker
// or a browser.

export const BRANCH = 'claims';
export const FILE = 'claims.json';
export const PRIVILEGED = 'privileged_agent_session';
export const TTL_MS = 24 * 60 * 60 * 1000;
/** A chunk (06.24, 17.4c3d) or a spec being chunked (06). */
export const CHUNK_ID = /^\d{2,}(\.\d+[a-z0-9]*)?$/;
/** A ledger star name (vega, vega-2): what may follow ~ in a session tag. */
export const STAR = /^[a-z]+(-\d+)?$/;

/**
 * Why the host refused a claims push, from git's stderr: 'protected' (a branch ruleset or protection restricts
 * updates to the owner: protected claims), 'race' (origin moved: fetch and redo), or 'other' (access, a hook).
 */
export function pushRefusal(stderr) {
  const s = String(stderr);
  if (/GH013|GH006|repository rule violations|protected branch|cannot update this protected ref|not allowed to push/i.test(s)) return 'protected';
  if (/\[rejected\]|non-fast-forward|fetch first|stale info|cannot lock ref/i.test(s)) return 'race';
  return 'other';
}

/** "who|ip|host|at|s:session~star|pr:n|held:login|b:base" → its parts. An older tag with no ~star reads star ''. */
export function parse(value) {
  const [who = '', ip = '', host = '', at = '', ...rest] = String(value).split('|');
  const field = (re) => rest.map((r) => re.exec(r)?.[1]).find(Boolean);
  const pr = field(/^pr:(\d+)$/);
  const tag = field(/^s:(.+)$/) ?? '';
  const cut = tag.lastIndexOf('~');
  const star = cut > 0 && STAR.test(tag.slice(cut + 1)) ? tag.slice(cut + 1) : '';
  const session = star ? tag.slice(0, cut) : tag;
  return { who, ip, host, at, session, star, pr: pr ? Number(pr) : null, held: field(/^held:(.+)$/) ?? '', base: field(/^b:(.+)$/) ?? '' };
}

export function format(c) {
  const extra = [
    ...(c.session ? [`s:${c.session}${c.star && STAR.test(c.star) ? `~${c.star}` : ''}`] : []),
    ...(c.pr ? [`pr:${c.pr}`] : []),
    ...(c.held ? [`held:${c.held}`] : []),
    ...(c.base && c.base !== 'main' ? [`b:${c.base}`] : []),
  ];
  return [c.who, c.ip, c.host, c.at, ...extra].map((p) => String(p).replace(/\|/g, '/')).join('|');
}

/** live, stale (past its 24 h, no PR), pr (waiting on review) or held (the owner assigned it to a person). */
export function state(c, now = Date.now()) {
  if (c.pr) return 'pr';
  if (c.held) return 'held';
  const t = Date.parse(c.at);
  return Number.isFinite(t) && now - t < TTL_MS ? 'live' : 'stale';
}

/**
 * Whether `me` holds this claim: the same claimant in the same session (by its id alone: a star never decides). A PR'd claim is also its author's on that
 * machine in any session (a later session carries the review); a claim with no session is its host's. A held claim is
 * its person's in any session on any machine: by their git name, or by their GitHub login (`me.login`), so the owner
 * can hold work for someone before knowing what their git name will be.
 */
export function mine(c, me) {
  if (c.held && me.login && c.held.toLowerCase() === String(me.login).toLowerCase()) return true;
  if (c.who !== me.who) return false;
  if (c.held) return true;
  if (c.session && c.session === me.session) return true;
  return (!c.session || Boolean(c.pr)) && c.host === me.host;
}

/**
 * Decide one claim against the current map. Returns { ok, why, reclaimed? }.
 * Free → ok. Mine → ok (renewed). Someone else's live or PR claim → refused, unless the owner forces. A stale one → ok,
 * reclaimed, except a privileged claim, which only the owner takes over.
 */
export function decide(current, me, now = Date.now(), { force = false } = {}) {
  if (!current) return { ok: true, why: 'free' };
  const c = parse(current);
  if (mine(c, me)) return { ok: true, why: 'yours' };
  if (force && me.owner) return { ok: true, why: 'taken over', reclaimed: c };
  const s = state(c, now);
  if (c.held) return { ok: false, why: `held for ${c.who} (@${c.held}) by the owner${c.pr ? ` (PR #${c.pr})` : ''}: only they or the owner release it` };
  if (s !== 'stale') return { ok: false, why: `held by ${c.who} on ${c.host} since ${c.at}${c.pr ? ` (PR #${c.pr})` : ''}` };
  if (c.who === PRIVILEGED && !me.owner) return { ok: false, why: `held by the owner (${PRIVILEGED}), stale since ${c.at}: ask them` };
  return { ok: true, why: 'reclaimed', reclaimed: c };
}

/** Chunk ids in plan order: by spec, then chunk number, then the rest of the id. */
export function byId(a, b) {
  const [as, ac] = a.split('.');
  const [bs, bc] = b.split('.');
  return Number(as) - Number(bs) || (parseInt(ac ?? '-1', 10) - parseInt(bc ?? '-1', 10)) || a.localeCompare(b);
}

/** claims.json's bytes: the map sorted by chunk, two-space JSON, a newline at the end. */
export function serialize(map) {
  const sorted = Object.fromEntries(Object.keys(map).sort(byId).map((k) => [k, map[k]]));
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

/** claims.json's text as a map; an unreadable file throws, never reads as empty (the next write would wipe everyone's). */
export function readMap(text, where = '') {
  let map;
  try {
    map = JSON.parse(text);
  } catch (e) {
    const why = e instanceof Error ? e.message.split('\n')[0] : String(e);
    throw new Error(`claims: ${FILE}${where ? ` at ${where}` : ''} can't be read (${why}); fix the branch, then retry.`);
  }
  if (!map || typeof map !== 'object' || Array.isArray(map)) throw new Error(`claims: ${FILE}${where ? ` at ${where}` : ''} is not a map.`);
  return map;
}

/**
 * What's wrong with a claim's ids, or null: none, one that isn't a chunk id, or a contributor's group. A contributor
 * claims one chunk per call, except a package (`pkg`: a heads-down session's batch of chunks, claimed in one call,
 * all or nothing, to build on one branch and land as one pull request).
 */
export function idsProblem(ids, me, { pkg = false } = {}) {
  if (!ids.length) return 'claims: no chunk named (e.g. 06.24).';
  for (const id of ids) if (!CHUNK_ID.test(id)) return `claims: "${id}" is not a chunk id (e.g. 06.24).`;
  if (new Set(ids).size !== ids.length) return 'claims: an id is named twice.';
  if (!me.owner && !pkg && ids.length !== 1) return 'claims: a contributor claims one chunk at a time (one id), or a package with --package.';
  return null;
}

/**
 * Claim `ids` for `me` in `map` at `now`, all or nothing: per-id results, and `next` ({ map, message }, a new map) when
 * every id may be claimed, else null. The caller checked idsProblem first. A spec being chunked (06) and its chunks
 * (06.3) exclude each other across claimants; a claim of your own keeps its PR, its hold and its base.
 */
export function claimInto(map, ids, me, now, { force = false, base = '' } = {}) {
  const results = ids.map((id) => {
    const own = decide(map[id], me, now, { force });
    if (!own.ok) return { id, ...own };
    const spec = id.split('.')[0];
    // A spec held for me already covers its chunks, wherever I claimed them: renewing the hold checks none of them.
    const current = map[id] ? parse(map[id]) : null;
    const related = current?.held && mine(current, me) ? [] : id.includes('.') ? [spec] : Object.keys(map).filter((k) => k.startsWith(`${spec}.`));
    for (const k of related) {
      if (ids.includes(k) || !map[k]) continue;
      const c = parse(map[k]);
      if (!mine(c, me) && state(c, now) !== 'stale' && !(force && me.owner)) {
        return { id, ok: false, why: c.held ? `${k} is held for ${c.who} (@${c.held})${k.includes('.') ? '' : ', the whole spec'}: only they or the owner release it` : `${k} is held by ${c.who} on ${c.host}` };
      }
    }
    return { id, ...own };
  });
  if (results.some((r) => !r.ok)) return { ok: false, results, next: null };
  const next = { ...map };
  const at = new Date(now).toISOString();
  for (const id of ids) {
    const prev = next[id] ? parse(next[id]) : null;
    const kept = prev && mine(prev, me) ? prev : null;
    next[id] = format({ ...me, at, pr: kept?.pr ?? null, held: kept?.held ?? '', base: base || kept?.base || '' });
  }
  return { ok: true, results, next: { map: next, message: `claim ${ids.join(', ')} · ${me.who}@${me.host}` } };
}

/**
 * Restart the clock on these (or, with none named, all) of `me`'s claims: which, and `next` or null for none. A claim
 * of this very session takes its star (one made before the session had a star gains it); any other keeps its own.
 */
export function renewIn(map, ids, me, now) {
  const next = { ...map };
  const done = [];
  const at = new Date(now).toISOString();
  for (const [id, v] of Object.entries(next)) {
    if (ids.length && !ids.includes(id)) continue;
    const c = parse(v);
    if (!mine(c, me)) continue;
    next[id] = format({ ...c, ip: me.ip, at, star: (c.session === me.session && me.star) || c.star });
    done.push(id);
  }
  return { done, next: done.length ? { map: next, message: `renew ${done.join(', ')} · ${me.who}@${me.host}` } : null };
}

/** Release `ids`: `me`'s own, or any with `force` from the owner. gone, kept (someone else's), and `next` or null. */
export function releaseFrom(map, ids, me, { force = false } = {}) {
  const next = { ...map };
  const gone = [];
  const kept = [];
  for (const id of ids) {
    if (!next[id]) continue;
    if ((force && me.owner) || mine(parse(next[id]), me)) gone.push(id);
    else kept.push(id);
  }
  for (const id of gone) delete next[id];
  return { gone, kept, next: gone.length ? { map: next, message: `release ${gone.join(', ')} · ${me.who}@${me.host}` } : null };
}

// --- the board: board.json beside claims.json on the same branch (spec 62) -----------------------------------------
// What sessions learned, as append-only entries: { id, type, chunk, by, session, at, text, detail?, count?, replaces?,
// invalidates?, invalidated? }. The file is { v, seq, entries }; `seq` is the last id handed out, so an id is never
// reused. Pure like the rest of this file: scripts/claims.mjs writes it over the same compare-and-swap.

export const BOARD_FILE = 'board.json';
/** The types a session may write. CLAIM mirrors claims.json and is read-only on the board. */
export const BOARD_TYPES = ['OBSERVED', 'FACT', 'FAIL', 'PATCH'];
/** Character caps on `text`; `detail` has none. */
export const CAPS = { text: 100, PATCH: 300 };
export const capOf = (type) => (type === 'PATCH' ? CAPS.PATCH : CAPS.text);

export const emptyBoard = () => ({ v: 1, seq: 0, entries: [] });

/** board.json's bytes: two-space JSON, a newline at the end. */
export function serializeBoard(board) {
  return `${JSON.stringify(board, null, 2)}\n`;
}

/** board.json's text as a board; an unreadable file throws, never reads as empty (the next write would wipe it). */
export function parseBoard(text, where = '') {
  let board;
  try {
    board = JSON.parse(text);
  } catch (e) {
    const why = e instanceof Error ? e.message.split('\n')[0] : String(e);
    throw new Error(`claims: ${BOARD_FILE}${where ? ` at ${where}` : ''} can't be read (${why}); fix the branch, then retry.`);
  }
  if (!board || typeof board !== 'object' || !Array.isArray(board.entries)) throw new Error(`claims: ${BOARD_FILE}${where ? ` at ${where}` : ''} is not a board.`);
  const at = where ? ` at ${where}` : '';
  if (board.v !== 1) throw new Error(`claims: ${BOARD_FILE}${at} is version ${board.v === undefined ? '(none)' : board.v}; this script reads version 1. Upgrade the kit, then retry.`);
  for (const e of board.entries) if (!e || typeof e !== 'object' || typeof e.id !== 'string' || typeof e.text !== 'string') throw new Error(`claims: ${BOARD_FILE}${at} is not a board (an entry is malformed).`);
  return { ...board, seq: seqOf(board) };
}

/** The last id handed out: never below an id already there, never negative, whatever `seq` says. */
function seqOf(board) {
  const top = board.entries.reduce((n, e) => Math.max(n, Number(/^b(\d+)$/.exec(String(e.id))?.[1]) || 0), 0);
  return Math.max(0, Number.isInteger(board.seq) ? board.seq : 0, top);
}

/** How long to wait before retry number `i` (0-based) of a lost race: exponential from 100 ms, capped at 2 s, half of it jitter. */
export function backoffMs(i, rand = Math.random) {
  const cap = Math.min(2000, 100 * 2 ** i);
  return Math.floor(cap / 2 + (rand() * cap) / 2);
}

/** Whether an entry belongs to `chunk`: its own, or one a duplicate of it came from. */
export function inChunk(e, chunk) {
  return e.chunk === chunk || Boolean(e.chunks?.includes(chunk));
}

const squash = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
/** Exact dedup's comparison: case, spacing and trailing punctuation do not make a new entry. */
export const normalize = (s) => squash(s).toLowerCase().replace(/[.!;:,\s]+$/, '');

const FILE_EXT = /\.(?:mjs|cjs|js|jsx|ts|tsx|json|md|py|rs|go|java|kt|rb|php|c|h|cc|cpp|hpp|cs|swift|sh|yml|yaml|toml|css|scss|html|sql|lock|txt)$/i;
const ERROR_CLASS = /\b(?:[A-Z][A-Za-z0-9]*(?:Error|Exception)|ERR_[A-Z_]+|E(?:NOENT|ACCES|EXIST|PERM|BUSY|ISDIR|NOTDIR|MFILE|ADDRINUSE|CONNREFUSED|TIMEDOUT)|TS\d{4,5})\b/;

/**
 * The second dedup key, from a failure's words: file path + symbol + error class + test name, lowercase, joined by `|`.
 * Language-neutral (paths by extension, errors by name, symbols in backticks or before a paren). null unless it names a
 * file and at least one more of the three: a bare file or a bare error is too coarse to call two notes one.
 */
export function dedupKey(text) {
  const s = squash(text);
  const files = (s.match(/[\w@.\\/-]+(?::\d+){0,2}/g) ?? []).map((t) => t.replace(/(?::\d+)+$/, '').replace(/\.+$/, '')).filter((t) => (/[\\/]/.test(t) || FILE_EXT.test(t)) && /\.[A-Za-z]\w{0,5}$/.test(t));
  const file = files[0]?.toLowerCase();
  if (!file) return null;
  const ticked = [...s.matchAll(/`([^`\s]+)`/g)].map((m) => m[1].replace(/\(\)$/, '')).filter((t) => !files.includes(t.replace(/(?::\d+)+$/, '')));
  const symbol = (ticked[0] ?? /\b([A-Za-z_]\w*)\(/.exec(s)?.[1] ?? '').toLowerCase();
  const error = (ERROR_CLASS.exec(s)?.[0] ?? '').toLowerCase();
  const name = /\bnot ok \d+ - (.+?)(?:\s+[(#]|$)/.exec(s)?.[1] ?? /\b(?:test|it)\s+(["'])(.+?)\1/i.exec(s)?.[2] ?? '';
  const parts = [file, symbol, error, normalize(name)].filter(Boolean);
  // A file and an error class alone is too coarse (two different TypeErrors in one file): a symbol or a test name must name it.
  return symbol || name ? parts.join('|') : null;
}

/** Why a note may not be written, or null: its type, chunk, author, session, and the caps. `text` is judged collapsed to one line. */
export function noteProblem(n) {
  if (n.type === 'CLAIM') return 'CLAIM mirrors claims.json and is read-only on the board.';
  if (!BOARD_TYPES.includes(n.type)) return `unknown type "${n.type}" (${BOARD_TYPES.join(', ')}).`;
  if (!CHUNK_ID.test(String(n.chunk ?? ''))) return `"${n.chunk ?? ''}" is not a chunk id (e.g. 62.1).`;
  if (!squash(n.by)) return 'by is empty: a note names its author.';
  if (!squash(n.session)) return 'session is empty: a note names its session.';
  const text = squash(n.text);
  if (!text) return 'text is empty.';
  const length = [...text].length;
  if (length > capOf(n.type)) return `text is ${length} characters;the ${n.type} cap is ${capOf(n.type)} (put the rest in --detail).`;
  return null;
}

/** An entry as a line of text: `(x3)` after a deduplicated one, `[invalidated]` after a PATCH a later FAIL struck. */
export function render(e) {
  return `${e.text}${e.count > 1 ? ` (x${e.count})` : ''}${e.invalidated ? ' [invalidated]' : ''}`;
}

/** The entries not replaced by a later PATCH of their author's: what a reader sees; the rest stay in the history. */
export function live(entries) {
  const gone = new Set(entries.map((e) => e.replaces).filter(Boolean));
  return entries.filter((e) => !gone.has(e.id));
}

/**
 * Write one note into `board` at `now`: { board (a new one), entry, outcome }. Throws when the note is refused.
 *   duplicate  a FACT, OBSERVED or FAIL with the same normalized text (a FAIL also with the same dedup key) bumps the
 *              first entry's `count`; the first entry, its author and its time stay. It spans chunks: a duplicate from
 *              another chunk adds that chunk to the entry's `chunks`, and one found by key keeps its wording in `detail`.
 *   replaced   a PATCH replaces its session's live PATCH for the same chunk (`replaces` names it); a PATCH never dedups.
 *   added      anything else.
 * A FAIL, added or a duplicate, marks the chunk's latest live PATCH `invalidated` (once), and a new one names it in
 * `invalidates`.
 */
export function addNote(board, n, now) {
  const problem = noteProblem(n);
  if (problem) throw new Error(`board: ${problem}`);
  const text = squash(n.text);
  const entries = board.entries.map((e) => ({ ...e }));
  const key = n.type === 'FAIL' ? dedupKey(text) : null;
  const sameText = normalize(text);
  const dup = n.type === 'PATCH' ? null : entries.find((e) => e.type === n.type && (normalize(e.text) === sameText || (key && dedupKey(e.text) === key)));
  let entry;
  let outcome;
  let seq = seqOf(board);
  if (dup) {
    dup.count = (dup.count ?? 1) + 1;
    // Dedup spans chunks: the entry remembers every chunk its duplicates came from, so a per-chunk reader still finds it.
    if (n.chunk !== dup.chunk && !dup.chunks?.includes(n.chunk)) dup.chunks = [...(dup.chunks ?? [dup.chunk]), n.chunk];
    // A duplicate found by key, not by text, keeps its own wording in the detail.
    if (normalize(dup.text) !== sameText) dup.detail = `${dup.detail ? `${dup.detail}\n` : ''}${text}`;
    if (n.detail && !dup.detail) dup.detail = n.detail;
    entry = dup;
    outcome = 'duplicate';
  } else {
    seq += 1;
    entry = { id: `b${seq}`, type: n.type, chunk: n.chunk, by: squash(n.by), session: squash(n.session), at: new Date(now).toISOString(), text };
    if (n.detail) entry.detail = n.detail;
    outcome = 'added';
    if (n.type === 'PATCH') {
      const prev = live(entries).filter((e) => e.type === 'PATCH' && e.chunk === n.chunk && e.session === entry.session).pop();
      if (prev) {
        entry.replaces = prev.id;
        outcome = 'replaced';
      }
    }
    entries.push(entry);
  }
  if (n.type === 'FAIL') {
    const patch = live(entries).filter((e) => e.type === 'PATCH' && e.chunk === n.chunk).pop();
    if (patch && !patch.invalidated) {
      patch.invalidated = true;
      if (!dup) entry.invalidates = patch.id;
    }
  }
  return { board: { ...board, v: 1, seq, entries }, entry, outcome };
}
