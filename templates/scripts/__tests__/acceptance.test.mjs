// pr/acceptance.mjs (the judge job's logic, spec 61 A1): proof lines parsed from a PR body, a closed ID with no line,
// a missing or red proof, and the parent replay with its guard-test escape. node:test, io faked, no git, no spawn.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { closedFromBody, closedFromDiff, judge, parseAcceptance, parseGuards, summary } from '../pr/acceptance.mjs';

const io = ({ files = [], red = [], added = [], onBase = [] } = {}) => ({
  exists: (p) => files.includes(p),
  run: (line) => ({ ok: !red.includes(line.proof) }),
  added: () => added,
  passesOnBase: (p) => onBase.includes(p),
});

const body = (...lines) => ['Closes A1.', '', '## Acceptance', ...lines, '', '## Notes', '- A9 · ignored/outside.test.mjs'].join('\n');

describe('parseAcceptance', () => {
  it('reads files, commands and no-test lines under ## Acceptance only', () => {
    const got = parseAcceptance(body('- A1 · test/a.test.mjs', '- A2 · `node --test x.mjs y.mjs`', '- A3 · npm run lint', '- A4 · (no test: prose only)', 'not a line'));
    assert.deepEqual(got.map((l) => [l.id, l.kind]), [['A1', 'files'], ['A2', 'command'], ['A3', 'command'], ['A4', 'no-test']]);
    assert.deepEqual(got[1].files, ['x.mjs', 'y.mjs']);
    assert.equal(got[3].reason, 'prose only');
  });

  it('splits comma-joined proof files and tolerates CRLF', () => {
    const got = parseAcceptance('## Acceptance\r\n- A1 · a.test.mjs, b.test.mjs\r\n');
    assert.deepEqual(got[0].files, ['a.test.mjs', 'b.test.mjs']);
  });
});

describe('closed IDs and guards', () => {
  it('reads closes lists from a body and removed A lines from a diff', () => {
    assert.deepEqual(closedFromBody('closes A1, a3 and A4'), ['A1', 'A3', 'A4']);
    assert.deepEqual(closedFromBody('no mention'), []);
    assert.deepEqual(closedFromDiff('-- **A1** gone\n- **A2** kept\n+- **A9** new\n-- **A3** gone'), ['A1', 'A3']);
  });

  it('a guard-test needs a reason', () => {
    const g = parseGuards('guard-test: t/a.test.mjs keeps the old contract\n- guard-test: t/b.test.mjs\nguard-test: t/c.test.mjs · reason');
    assert.deepEqual([...g.keys()], ['t/a.test.mjs', 't/c.test.mjs']);
  });
});

describe('judge', () => {
  it('passes when every closed ID has a green proof', () => {
    const r = judge({ body: body('- A1 · t/a.test.mjs'), io: io({ files: ['t/a.test.mjs'] }) });
    assert.equal(r.ok, true);
    assert.equal(r.rows[0].status, 'pass');
  });

  it('A1 clause 1: a closed ID with no proof line fails', () => {
    const r = judge({ body: 'closes A1, A2\n\n## Acceptance\n- A1 · t/a.test.mjs\n', io: io({ files: ['t/a.test.mjs'] }) });
    assert.equal(r.ok, false);
    assert.equal(r.rows.find((x) => x.id === 'A2').status, 'no-line');
    assert.match(r.failures[0], /A2: closed with no proof line/);
  });

  it('closed IDs passed in (the spec diff) need lines too, and a bare (no test: ) fails', () => {
    const r = judge({ body: body('- A2 · (no test: )'), closed: ['A2', 'A7'], io: io() });
    assert.deepEqual(r.rows.map((x) => [x.id, x.status]), [['A1', 'no-line'], ['A2', 'no-reason'], ['A7', 'no-line']]);
  });

  it('A1 clause 2: a named proof file that is missing fails, and one that is red fails', () => {
    const miss = judge({ body: body('- A1 · t/gone.test.mjs'), io: io() });
    assert.equal(miss.rows[0].status, 'missing');
    assert.equal(miss.ok, false);
    const red = judge({ body: body('- A1 · t/a.test.mjs'), io: io({ files: ['t/a.test.mjs'], red: ['t/a.test.mjs'] }) });
    assert.equal(red.rows[0].status, 'red');
    assert.equal(red.ok, false);
  });

  it('a no-test line with a reason is the proof', () => {
    assert.equal(judge({ body: body('- A1 · (no test: prose)'), io: io() }).ok, true);
  });

  it('A1 clause 3: an added test that passes on the merge base fails unless guard-test names it', () => {
    const files = ['t/a.test.mjs', 't/new.test.mjs'];
    const base = body('- A1 · t/a.test.mjs');
    const plain = judge({ body: base, io: io({ files, added: ['t/new.test.mjs', 'README.md'], onBase: ['t/new.test.mjs'] }) });
    assert.equal(plain.ok, false);
    assert.equal(plain.replay[0].status, 'passes-on-base');
    const guarded = judge({ body: `${base}\nguard-test: t/new.test.mjs stays green on purpose`, io: io({ files, added: ['t/new.test.mjs'], onBase: ['t/new.test.mjs'] }) });
    assert.equal(guarded.ok, true);
    assert.equal(guarded.replay[0].status, 'guarded');
    const fails = judge({ body: base, io: io({ files, added: ['t/new.test.mjs'], onBase: [] }) });
    assert.equal(fails.ok, true);
    assert.equal(fails.replay[0].status, 'fails-on-base');
  });

  it('a guard naming another file does not excuse this one', () => {
    const r = judge({ body: `${body('- A1 · t/a.test.mjs')}\nguard-test: t/other.test.mjs why`, io: io({ files: ['t/a.test.mjs', 't/new.test.mjs'], added: ['t/new.test.mjs'], onBase: ['t/new.test.mjs'] }) });
    assert.equal(r.ok, false);
  });

  it('writes one summary row per A-ID', () => {
    const r = judge({ body: body('- A1 · (no test: prose)'), closed: ['A2'], io: io() });
    const rows = summary(r).split('\n').filter((l) => /^\| A\d/.test(l));
    assert.equal(rows.length, 2);
  });
});
