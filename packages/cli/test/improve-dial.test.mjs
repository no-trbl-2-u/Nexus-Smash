// The improvement dial in Settings (spec 59, A4): four radios with one-line explanations, reading and writing the
// `Improve:` line inside `## Plan expansion posture` of plan/bearings.md (GET and POST /api/improve), and nothing else
// in that file. The parse must agree with the repo's own resolver, scripts/plan/improve.mjs.
import './jsx.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { POSITIONS, readPosition, withPosition, readImprove, writeImprove } from '../server/improve.mjs';
import { startServer } from '../server/server.mjs';
import { removeTreeSync } from './helpers/tmp.mjs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

const HEAD = '# Bearings\n\nProse.\n\n';
const POSTURE = '## Plan expansion posture\n\n**bold** - prose.\n\n- Promote: aged\n- veto_days: 3\n\n';
const TAIL = '## Voice\n\nPlain.\n';
const crlf = (s) => s.replace(/\n/g, '\r\n');

test('the dial is off, gentle, steady, bold; an absent line reads gentle and unset', () => {
  assert.deepEqual(POSITIONS, ['off', 'gentle', 'steady', 'bold']);
  assert.deepEqual(readPosition(HEAD + POSTURE + TAIL), { position: 'gentle', set: false });
  assert.deepEqual(readPosition(''), { position: 'gentle', set: false });
});

test('a present line is read: bullets, bold keys, comments and case; the first of several wins; junk reads gentle', () => {
  const at = (line) => readPosition(`${HEAD}## Plan expansion posture\n\n${line}\n\n${TAIL}`);
  assert.deepEqual(at('Improve: bold'), { position: 'bold', set: true });
  assert.deepEqual(at('- Improve: Steady # for now'), { position: 'steady', set: true });
  assert.deepEqual(at('**Improve:** off'), { position: 'off', set: true });
  assert.deepEqual(at('Improve: bold\nImprove: off'), { position: 'bold', set: true });
  assert.deepEqual(at('Improve: loud'), { position: 'gentle', set: true });
});

test('only a line inside the section counts: not another section, a fenced block or a comment', () => {
  assert.equal(readPosition(`${HEAD}Improve: bold\n\n${POSTURE}${TAIL}`).set, false, 'before the section');
  assert.equal(readPosition(`${HEAD}${POSTURE}${TAIL}Improve: bold\n`).set, false, 'after it');
  assert.equal(readPosition(`${HEAD}${POSTURE}\`\`\`\nImprove: bold\n\`\`\`\n\n${TAIL}`).set, false, 'fenced');
  assert.equal(readPosition(`${HEAD}${POSTURE}<!--\nImprove: bold\n-->\n${TAIL}`).set, false, 'commented');
});

test('writing replaces the one line in place and touches no other', () => {
  const before = `${HEAD}## Plan expansion posture\n\n**bold** - prose.\n\nImprove: gentle\n\n- Promote: aged\n\n${TAIL}`;
  const after = withPosition(before, 'bold');
  assert.equal(after, before.replace('Improve: gentle', 'Improve: bold'));
  assert.equal(withPosition(after, 'bold'), after, 'the same value is a no-op');
  const bullet = `${HEAD}## Plan expansion posture\n\n- Improve: **gentle** # note\n- Promote: aged\n${TAIL}`;
  assert.equal(withPosition(bullet, 'steady'), bullet.replace('gentle', 'steady'), 'only the value changes: bullet, bold marks and note stay');
});

test('writing with the line absent adds it under the heading as its own paragraph', () => {
  const before = HEAD + POSTURE + TAIL;
  const after = withPosition(before, 'steady');
  assert.equal(after, before.replace('## Plan expansion posture\n\n', '## Plan expansion posture\n\nImprove: steady\n\n'));
  assert.deepEqual(readPosition(after), { position: 'steady', set: true });
  // A heading with prose straight under it: a blank line goes both sides, so the prose does not fold into the line.
  const tight = `${HEAD}## Plan expansion posture\nprose here\n\n${TAIL}`;
  assert.equal(withPosition(tight, 'off'), `${HEAD}## Plan expansion posture\n\nImprove: off\n\nprose here\n\n${TAIL}`);
});

test('writing with no section at all adds the section at the end', () => {
  const after = withPosition('# Bearings\n\nProse.\n', 'bold');
  assert.equal(after, '# Bearings\n\nProse.\n\n## Plan expansion posture\n\nImprove: bold\n');
  assert.deepEqual(readPosition(after), { position: 'bold', set: true });
  assert.equal(withPosition('', 'gentle'), '## Plan expansion posture\n\nImprove: gentle\n');
});

test('CRLF files stay CRLF, with and without the line, and a BOM stays', () => {
  const present = crlf(`${HEAD}## Plan expansion posture\n\nImprove: gentle\n\n${TAIL}`);
  assert.deepEqual(readPosition(present), { position: 'gentle', set: true });
  const a = withPosition(present, 'bold');
  assert.equal(a, present.replace('gentle', 'bold'));
  assert.ok(!/[^\r]\n/.test(a), 'every line ending is still CRLF');

  const absent = crlf(HEAD + POSTURE + TAIL);
  const b = withPosition(absent, 'steady');
  assert.deepEqual(readPosition(b), { position: 'steady', set: true });
  assert.ok(!/[^\r]\n/.test(b), 'an added line is CRLF too');
  assert.equal(b.replace('Improve: steady\r\n\r\n', ''), absent, 'nothing else moved');

  const bom = `﻿${HEAD}${POSTURE}${TAIL}`;
  assert.ok(withPosition(bom, 'off').startsWith(`﻿# Bearings`));
});

test('a read-only plan/bearings.md is a clear 409 and leaves no temp file', (t) => {
  const dir = tmpRepo(HEAD + POSTURE + TAIL);
  const file = path.join(dir, 'plan', 'bearings.md');
  try {
    fs.chmodSync(file, 0o444);
    try { fs.accessSync(file, fs.constants.W_OK); return t.skip('this platform lets the file be written anyway'); } catch { /* read-only */ }
    const r = writeImprove(dir, { position: 'bold' });
    assert.equal(r.status, 409);
    assert.match(r.error, /plan\/bearings\.md is read-only/);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'plan')), ['bearings.md'], 'no temp file left');
    assert.equal(fs.readFileSync(file, 'utf8'), HEAD + POSTURE + TAIL);
  } finally { try { fs.chmodSync(file, 0o644); } catch { /* gone */ } removeTreeSync(dir); }
});

test('a position the dial does not have is refused', () => {
  assert.throws(() => withPosition(HEAD, 'loud'), RangeError);
  assert.equal(writeImprove(os.tmpdir(), { position: 'loud' }).status, 400);
  assert.equal(writeImprove(os.tmpdir(), {}).status, 400);
});

function tmpRepo(bearings) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-improve-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir });
  if (bearings != null) {
    fs.mkdirSync(path.join(dir, 'plan'));
    fs.writeFileSync(path.join(dir, 'plan', 'bearings.md'), bearings);
  }
  return dir;
}

test('readImprove and writeImprove on a checkout: absent file reads gentle and will not be invented', () => {
  const none = tmpRepo(null);
  try {
    assert.deepEqual(readImprove(none), { position: 'gentle', set: false, positions: POSITIONS, file: 'plan/bearings.md' });
    const r = writeImprove(none, { position: 'bold' });
    assert.equal(r.status, 404);
    assert.ok(!fs.existsSync(path.join(none, 'plan')), 'no plan/ made by the GUI');
  } finally { removeTreeSync(none); }

  for (const [name, text] of [['LF', HEAD + POSTURE + TAIL], ['CRLF', crlf(HEAD + POSTURE + TAIL)]]) {
    const dir = tmpRepo(text);
    try {
      const file = path.join(dir, 'plan', 'bearings.md');
      const r = writeImprove(dir, { position: 'Bold' });
      assert.equal(r.status, 200, name);
      assert.equal(r.position, 'bold');
      assert.equal(r.set, true);
      assert.equal(fs.readFileSync(file, 'utf8'), withPosition(text, 'bold'), `${name}: written as withPosition gives it`);
      assert.equal(readImprove(dir).position, 'bold');
      assert.deepEqual(fs.readdirSync(path.join(dir, 'plan')), ['bearings.md'], 'no temp file left');
    } finally { removeTreeSync(dir); }
  }
});

const SEC = '## Plan expansion posture\n\n';
const EDGE = [
  `${HEAD}${SEC}prose

    Improve: bold

${TAIL}`, // an indented code block
  `${HEAD}${SEC}Improve: bold <!-- x -->

${TAIL}`,
  `${HEAD}${SEC}<!-- c --> Improve: bold

${TAIL}`,
  `${HEAD}${SEC}<!-- opened
Improve: bold
closes --> Improve: steady

${TAIL}`,
  `${HEAD}${SEC}prose\r\rImprove: bold\r\r${TAIL}`, // a lone CR
  `${HEAD}${SEC}- item

    Improve: bold

    Improve: off

${TAIL}`,
];

test('the parse agrees with the repo\'s own resolver (scripts/plan/improve.mjs) when the CLI sits in the kit', async (t) => {
  const url = new URL('../../../scripts/plan/improve.mjs', import.meta.url);
  if (!fs.existsSync(url)) return t.skip('the kit\'s scripts are not beside this package');
  const { dial } = await import(url.href);
  const cases = [HEAD + POSTURE + TAIL, `${HEAD}${POSTURE.replace('- Promote', 'Improve: steady\n- Promote')}${TAIL}`, `${HEAD}Improve: bold\n\n${POSTURE}${TAIL}`,
    `${HEAD}${POSTURE}\`\`\`\nImprove: bold\n\`\`\`\n${TAIL}`, crlf(`${HEAD}## Plan expansion posture\n\n- Improve: off\n\n${TAIL}`), ...EDGE];
  for (const c of cases) {
    const want = dial(c);
    assert.deepEqual(readPosition(c), { position: want.position, set: want.set });
    for (const p of POSITIONS) assert.equal(dial(withPosition(c, p)).position, p, `${p} round-trips through the resolver`);
  }
});

function req(port, { method = 'GET', pathname, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: pathname, headers }, (res) => {
      let data = '';
      res.on('data', (d) => { data += d; });
      res.on('end', () => resolve({ status: res.statusCode, data: data ? JSON.parse(data) : null }));
    });
    r.on('error', reject);
    r.end(body);
  });
}

test('GET and POST /api/improve through the server', async () => {
  const repo = tmpRepo(HEAD + POSTURE + TAIL);
  const provider = () => ({ kind: 'fake', active: false, send() {}, async interrupt() {}, async stop() {}, async fresh() {} });
  const app = await startServer({ repo, provider, pollRuns: false, dist: path.join(os.tmpdir(), 'nexus-cli-no-dist') });
  const get = { 'x-nexus-token': app.token };
  const post = { ...get, 'content-type': 'application/json', origin: `http://127.0.0.1:${app.port}` };
  try {
    assert.deepEqual((await req(app.port, { pathname: '/api/improve', headers: get })).data.position, 'gentle');
    const w = await req(app.port, { method: 'POST', pathname: '/api/improve', headers: post, body: JSON.stringify({ position: 'steady' }) });
    assert.equal(w.status, 200);
    assert.equal(w.data.position, 'steady');
    assert.match(fs.readFileSync(path.join(repo, 'plan', 'bearings.md'), 'utf8'), /\nImprove: steady\n/);
    assert.equal((await req(app.port, { pathname: '/api/improve', headers: get })).data.position, 'steady');
    const bad = await req(app.port, { method: 'POST', pathname: '/api/improve', headers: post, body: JSON.stringify({ position: 'loud' }) });
    assert.equal(bad.status, 400);
  } finally {
    await app.close();
    removeTreeSync(repo);
  }
});

test('Settings\' control: four radios with one-line explanations, Gentle checked when unset, wired to /api/improve', async () => {
  const { ImproveDial, IMPROVE_CHOICES, shownPosition } = await import('../src/screens/cloud-settings/improve-dial.jsx');
  const html = (props) => renderToStaticMarkup(createElement(ImproveDial, props));
  assert.deepEqual(IMPROVE_CHOICES.map((c) => c.value), POSITIONS);
  for (const c of IMPROVE_CHOICES) assert.ok(c.sub && !c.sub.includes('\n'), `${c.label} has a one-line explanation`);
  const unset = html({ value: undefined });
  assert.equal((unset.match(/type="radio"/g) || []).length, 4);
  assert.match(unset, /role="radiogroup" aria-label="How hard the loop improves"/);
  assert.match(unset, /checked="" value="gentle"/);
  assert.equal((unset.match(/checked=""/g) || []).length, 1);
  assert.match(html({ value: 'bold' }), /checked="" value="bold"/);
  assert.equal(shownPosition('loud'), 'gentle');
  for (const c of IMPROVE_CHOICES) assert.ok(unset.includes(c.sub.replace(/'/g, '&#x27;')), `${c.label}'s line is drawn`);

  const src = read('../src/screens/Settings.jsx');
  assert.match(src, /How hard the loop improves/);
  assert.match(src, /api\('\/api\/improve', \{ position \}\)/);
  assert.match(src, /import \{ ImproveDial \} from '\.\/cloud-settings\/improve-dial\.jsx'/);
  const comp = read('../src/screens/cloud-settings/improve-dial.jsx');
  assert.doesNotMatch(comp, /#[0-9a-fA-F]{3,8}\b|animation|@keyframes|style=/, 'no colour, motion or inline style of its own');
});
