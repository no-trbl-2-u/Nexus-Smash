// The improvement dial (spec 59, A4): `Improve: off | gentle | steady | bold` in plan/bearings.md, inside
// `## Plan expansion posture`. Settings reads it (GET /api/improve) and writes it (POST /api/improve { position }).
//
// The parse mirrors scripts/plan/improve.mjs in the repo (the CLI ships without the kit's scripts, so it keeps its own
// copy of the three rules): only a line inside the section counts, fenced code and HTML comments are not prose, the
// first of several wins, and an absent or unreadable value reads as `gentle`. A write changes that one line in place
// (or adds it under the heading when absent, or adds the section at the end when the file has none) and touches no
// other line; the file's line endings (LF or CRLF) and a BOM stay as they were.
import fs from 'node:fs';
import path from 'node:path';

export const POSITIONS = ['off', 'gentle', 'steady', 'bold'];
export const DEFAULT_POSITION = 'gentle';
export const BEARINGS_FILE = 'plan/bearings.md';
const HEADING = /^##[ \t]+Plan expansion posture\b.*$/;
const ANY_HEADING = /^#{1,3}[ \t]/;
const IMPROVE = /^[ \t]*(?:[-*][ \t]+)?[*`]*Improve[*`]*[ \t]*:[*`]*[ \t]*[*`]*([\w-]+)[*`]*[ \t]*[.,;]*[ \t]*(?:#.*)?$/i;

/** Which lines are prose: false inside a fenced block or an HTML comment. */
function proseMask(lines) {
  const mask = [];
  let fence = null;
  let comment = false;
  for (const l of lines) {
    if (comment) { mask.push(false); if (l.includes('-->')) comment = false; continue; }
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(l);
    if (fence) {
      mask.push(false);
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      continue;
    }
    if (f) { fence = f[1]; mask.push(false); continue; }
    if (l.includes('<!--') && !l.includes('-->', l.indexOf('<!--'))) { comment = true; mask.push(false); continue; }
    mask.push(true);
  }
  return mask;
}

/** { lines, eol, bom, head, end, at }: the file split, the section's heading and end (exclusive) and the Improve line, or -1s. */
function locate(text) {
  const bom = text.startsWith('﻿') ? '﻿' : '';
  const body = bom ? text.slice(1) : text;
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  const lines = body.split(/\r?\n/);
  const mask = proseMask(lines);
  const head = lines.findIndex((l, i) => mask[i] && HEADING.test(l));
  let end = -1;
  let at = -1;
  if (head >= 0) {
    end = lines.findIndex((l, i) => i > head && mask[i] && ANY_HEADING.test(l));
    if (end < 0) end = lines.length;
    for (let i = head + 1; i < end; i += 1) if (mask[i] && IMPROVE.test(lines[i])) { at = i; break; }
  }
  return { lines, eol, bom, head, end, at };
}

/** The dial from bearings text: { position, set }. */
export function readPosition(text = '') {
  const { lines, at } = locate(String(text ?? ''));
  if (at < 0) return { position: DEFAULT_POSITION, set: false };
  const v = IMPROVE.exec(lines[at])[1].toLowerCase();
  return POSITIONS.includes(v) ? { position: v, set: true } : { position: DEFAULT_POSITION, set: true };
}

/** The bearings text with the dial set to `position`: the one line replaced or added, nothing else touched. */
export function withPosition(text = '', position) {
  if (!POSITIONS.includes(position)) throw new RangeError(`Improve must be one of ${POSITIONS.join(' | ')}`);
  const { lines, eol, bom, head, at } = locate(String(text ?? ''));
  const line = `Improve: ${position}`;
  if (at >= 0) {
    const old = lines[at];
    lines[at] = old.replace(/^([ \t]*(?:[-*][ \t]+)?)[\s\S]*$/, (_, lead) => `${lead}${line}`);
  } else if (head >= 0) {
    lines.splice(head + 1, 0, '', line); // its own paragraph, straight under the heading
    if (lines[head + 3] !== undefined && lines[head + 3].trim() !== '') lines.splice(head + 3, 0, '');
  } else {
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    if (lines.length) lines.push('');
    lines.push('## Plan expansion posture', '', line, '');
  }
  return bom + lines.join(eol);
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
    fs.writeFileSync(tmp, next);
    fs.renameSync(tmp, file);
  }
  return { status: 200, ...readImprove(repo) };
}
