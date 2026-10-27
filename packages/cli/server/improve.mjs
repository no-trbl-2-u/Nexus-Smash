// The improvement dial (spec 59, A4): `Improve: off | gentle | steady | bold` in plan/bearings.md, inside
// `## Plan expansion posture`. Settings reads it (GET /api/improve) and writes it (POST /api/improve { position }).
//
// The parse is scripts/plan/improve.mjs's own (the CLI ships without the kit's scripts, so it keeps a copy: strip,
// section, values), so both read the same line: only one inside the section counts, code (fenced or indented) and
// HTML comments are not prose, the first of several wins, absent or unreadable reads `gentle`. A write changes the
// value on the line the resolver reads, or adds a line under the heading when there is none (or the only match is in
// code), or adds the section at the end; no other line is touched, and LF or CRLF endings and a BOM stay.
import fs from 'node:fs';
import path from 'node:path';

export const POSITIONS = ['off', 'gentle', 'steady', 'bold'];
export const DEFAULT_POSITION = 'gentle';
export const BEARINGS_FILE = 'plan/bearings.md';
const esc = (key) => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// strip, section and values are scripts/plan/improve.mjs's, line for line, so the two read the same line.
/**
 * Bearings text with what is not prose removed: a BOM, HTML comments, fenced (``` or ~~~) code blocks, and indented
 * code blocks (four spaces or a tab after a blank line, unless the text above is a list item's continuation).
 */
function strip(text) {
  const lines = String(text ?? '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, '').split('\n');
  const out = [];
  let fence = null;
  let prevBlank = true;
  let inList = false;
  let inCode = false;
  for (const l of lines) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(l);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      out.push('');
      continue;
    }
    if (f) { fence = f[1]; out.push(''); continue; }
    const blank = !l.trim();
    if (!blank && /^( {4}|\t)/.test(l) && ((prevBlank && !inList) || inCode)) { inCode = true; out.push(''); prevBlank = false; continue; }
    inCode = false;
    if (!blank) inList = /^\s*(?:[-*+]|\d+[.)])\s/.test(l) || (inList && /^\s/.test(l));
    prevBlank = blank;
    out.push(l);
  }
  return out.join('\n');
}

/** A `## <name>` section of already-stripped text, up to the next heading of level 1 to 3: { body, rest } or null. */
function section(text, name) {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => new RegExp(`^##\\s+${esc(name)}\\b.*$`).test(l));
  if (at < 0) return null;
  const end = lines.findIndex((l, i) => i > at && /^#{1,3}\s/.test(l));
  const stop = end < 0 ? lines.length : end;
  return { body: lines.slice(at + 1, stop).join('\n'), rest: [...lines.slice(0, at), ...lines.slice(stop)].join('\n') };
}

/** Every `Key: value` line of the text: the value is the whole rest of the line, less trailing punctuation and a # comment. */
function values(text, key) {
  const re = new RegExp(`^[ \\t]*(?:[-*][ \\t]+)?[*\`]*${esc(key)}[*\`]*[ \\t]*:[*\`]*[ \\t]*[*\`]*([\\w-]+)[*\`]*[ \\t]*[.,;]*[ \\t]*(?:#.*)?$`, 'gmi');
  return [...text.matchAll(re)].map((m) => m[1]);
}

/** The dial from bearings text, as the resolver reads it: { position, set }. */
export function readPosition(text = '') {
  const sec = section(strip(text), 'Plan expansion posture');
  const found = sec ? values(sec.body, 'Improve') : [];
  if (!found.length) return { position: DEFAULT_POSITION, set: false };
  const v = found[0].toLowerCase();
  return POSITIONS.includes(v) ? { position: v, set: true } : { position: DEFAULT_POSITION, set: true };
}

const agrees = (text, position) => { const r = readPosition(text); return r.set && r.position === position; };

/**
 * The bearings text with the dial set to `position`: one line changed or added, nothing else touched. The line
 * changed is the one the resolver reads (the first that reads as `position` once it is changed); a match inside code
 * or a comment is left alone, and a fresh line goes under the heading instead.
 */
export function withPosition(text = '', position) {
  if (!POSITIONS.includes(position)) throw new RangeError(`Improve must be one of ${POSITIONS.join(' | ')}`);
  const src = String(text ?? '');
  if (agrees(src, position)) return src;
  const bom = src.startsWith('\uFEFF') ? '\uFEFF' : '';
  const lines = src.slice(bom.length).split('\n');
  const crlf = src.includes('\r\n');
  const cr = crlf ? '\r' : '';
  const build = (ls) => bom + ls.join('\n');
  // 1. Change the value on a line that already carries one (bullet, bold marks, comments and notes stay).
  const key = /(Improve[*`]*[ \t]*:[*`]*[ \t]*[*`]*)([\w-]+)/i;
  for (let i = 0; i < lines.length; i += 1) {
    if (!key.test(lines[i])) continue;
    const next = lines.slice();
    next[i] = lines[i].replace(key, (_, lead) => `${lead}${position}`);
    if (agrees(build(next), position)) return build(next);
  }
  // 2. Add a line under the heading, as its own paragraph.
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^##\s+Plan expansion posture\b/.test(lines[i])) continue;
    const next = lines.slice();
    const tail = lines[i + 1] !== undefined && lines[i + 1].replace(/\r$/, '').trim() !== '' ? [cr] : [];
    next.splice(i + 1, 0, cr, `Improve: ${position}${cr}`, ...tail.map(() => cr));
    // a blank line before, the line, a blank line after (unless one is there)
    if (agrees(build(next), position)) return build(next);
  }
  // 3. No section the resolver can see: add one at the end.
  const end = lines.slice();
  while (end.length && end[end.length - 1].replace(/\r$/, '') === '') end.pop();
  if (end.length) end.push(cr);
  end.push(`## Plan expansion posture${cr}`, cr, `Improve: ${position}${cr}`, '');
  return build(end);
}
/** GET /api/improve: { position, set, positions, file } from the checkout's plan/bearings.md (absent file: gentle, unset). */
export function readImprove(repo) {
  let text = '';
  try { text = fs.readFileSync(path.join(repo, BEARINGS_FILE), 'utf8'); } catch { /* none yet */ }
  return { ...readPosition(text), positions: POSITIONS, file: BEARINGS_FILE };
}

/** POST /api/improve { position }: { status, ...view } or { status, error }. Writes only when the line changes. */
export function writeImprove(repo, body = {}) {
  const position = typeof body?.position === 'string' ? body.position.toLowerCase() : '';
  if (!POSITIONS.includes(position)) return { status: 400, error: `position must be one of ${POSITIONS.join(' | ')}` };
  const file = path.join(repo, BEARINGS_FILE);
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return { status: 404, error: `${BEARINGS_FILE} not found in this checkout` }; }
  const next = withPosition(text, position);
  if (next !== text) {
    const tmp = `${file}.${process.pid}.tmp`;
    const readOnly = { status: 409, error: `${BEARINGS_FILE} is read-only` };
    try { fs.accessSync(file, fs.constants.W_OK); } catch { return readOnly; }
    try {
      fs.writeFileSync(tmp, next);
      fs.renameSync(tmp, file);
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch { /* never written */ }
      if (['EPERM', 'EACCES', 'EROFS'].includes(e.code)) return readOnly;
      throw e;
    }
  }
  return { status: 200, ...readImprove(repo) };
}
