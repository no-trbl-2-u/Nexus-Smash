// eval/ledger.mjs (the escape ledger, spec 61 A3): the four escapes counted per merged PR from gh fixtures, the fix
// window, the rendered file and the summary line. node:test, gh faked, no network, no git.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { closedIds, counts, fixesFor, fetchMerged, hadJudge, ledger, mergedEarly, render, rows, summaryLine, unprovenLines } from '../eval/ledger.mjs';

const chk = (name, started, completed, conclusion = 'SUCCESS') => ({ name, status: completed ? 'COMPLETED' : 'IN_PROGRESS', conclusion, startedAt: started, completedAt: completed });
const pr = (number, title, mergedAt, { body = '', checks = [] } = {}) => ({ number, title, body, mergedAt, statusCheckRollup: checks });

// Hand-built history: #1 merged with a check still running and a windows job that ended after the merge, #2 has
// the judge and a proof line, #3 and #4 are fixes (one by number, one by chunk id), #5 is a late fix, #6 is clean.
const history = [
  pr(1, 'ci: actions on Node 24 (39.11)', '2026-10-20T10:00:00Z', {
    body: 'Closes **A12** of spec 39.',
    checks: [chk('test', '2026-10-20T09:50:00Z', '2026-10-20T09:55:00Z'), chk('git-suites (windows-latest)', '2026-10-20T09:50:00Z', '2026-10-20T10:02:00Z', 'FAILURE'), chk('release', '2026-10-20T10:00:30Z', '2026-10-20T10:01:00Z')],
  }),
  pr(2, 'ci: the judge job (61.2)', '2026-10-20T12:00:00Z', {
    body: 'Closes A2.\n\n## Acceptance\n- A2 · scripts/__tests__/judge.test.mjs\n',
    checks: [chk('judge', '2026-10-20T11:50:00Z', '2026-10-20T11:51:00Z'), chk('test', '2026-10-20T11:50:00Z', '2026-10-20T11:55:00Z')],
  }),
  pr(3, 'fix: the Node 24 check catches quoted pins (39.11 review)', '2026-10-21T10:00:00Z', {
    body: 'A follow-up to [#1](https://github.com/o/r/pull/1).',
    checks: [chk('test', '2026-10-21T09:50:00Z', '2026-10-21T09:55:00Z')],
  }),
  pr(4, 'fix: a second repair, by chunk id only (61.2 review)', '2026-10-22T10:00:00Z', { checks: [] }),
  pr(5, 'fix: a repair of #2 too late to count', '2026-10-30T10:00:00Z', { checks: [chk('test', '2026-10-30T09:00:00Z', '2026-10-30T09:05:00Z')] }),
  pr(6, 'feat: something clean (70.1)', '2026-10-25T10:00:00Z', {
    body: 'Closes A1, A2.\n\n## Acceptance\n- A1 · (no test: prose)\n',
    checks: [chk('judge', '2026-10-25T09:00:00Z', '2026-10-25T09:01:00Z'), chk('test', '2026-10-25T09:00:00Z', '2026-10-25T09:30:00Z')],
  }),
];

describe('merged before checks finished', () => {
  it('flags a started check that ended after the merge or never ended', () => {
    assert.equal(mergedEarly(history[0].statusCheckRollup, history[0].mergedAt), true);
    assert.equal(mergedEarly([chk('test', '2026-10-20T09:00:00Z', null)], '2026-10-20T10:00:00Z'), true);
  });

  it('ignores a run that started after the merge, and a clean set', () => {
    assert.equal(mergedEarly([chk('test', '2026-10-20T09:00:00Z', '2026-10-20T09:30:00Z'), chk('release', '2026-10-20T10:05:00Z', '2026-10-20T10:06:00Z')], '2026-10-20T10:00:00Z'), false);
    assert.equal(mergedEarly([], '2026-10-20T10:00:00Z'), false);
  });
});

describe('judge run', () => {
  it('needs a check named judge that had started by the merge', () => {
    assert.equal(hadJudge(history[1].statusCheckRollup, history[1].mergedAt), true);
    assert.equal(hadJudge(history[0].statusCheckRollup, history[0].mergedAt), false);
    assert.equal(hadJudge([chk('judge', '2026-10-20T10:05:00Z', '2026-10-20T10:06:00Z')], '2026-10-20T10:00:00Z'), false);
  });

  it('reads a status context as a name too', () => {
    assert.equal(hadJudge([{ context: 'judge', state: 'SUCCESS' }], '2026-10-20T10:00:00Z'), true);
  });
});

describe('acceptance lines with no proof', () => {
  it('reads the closes spellings, and a negation closes nothing', () => {
    assert.deepEqual(closedIds('Closes **A4** of spec 59 (chunk 59.4).'), ['A4']);
    assert.deepEqual(closedIds('closes A1, A2 and A3'), ['A1', 'A2', 'A3']);
    assert.deepEqual(closedIds('This does not close A1.'), []);
    assert.deepEqual(closedIds('```\nCloses A9\n```'), []);
    assert.deepEqual(closedIds('The IDs are the union of `closes A1, A2` in the body.\nCloses **A1** of spec 61.'), ['A1']);
  });

  it('counts a closed ID without a proof line and each (no test:) line', () => {
    assert.equal(unprovenLines('Closes A2.'), 1);
    assert.equal(unprovenLines('Closes A2.\n\n## Acceptance\n- A2 · a.test.mjs\n'), 0);
    assert.equal(unprovenLines('Closes A1, A2.\n\n## Acceptance\n- A1 · (no test: prose)\n'), 2);
    assert.equal(unprovenLines('A follow-up, closes nothing.'), 0);
  });
});

describe('a fix within seven days', () => {
  const sorted = rows(history);
  const fixed = Object.fromEntries(sorted.map((r) => [r.number, r.fixedBy]));

  it('names the fix by PR number or by a shared chunk id', () => {
    assert.deepEqual(fixed[1], [3]);
    assert.deepEqual(fixed[2], [4]);
  });

  it('ignores a fix after the window, a non-fix, and an earlier PR', () => {
    assert.deepEqual(fixed[6], []);
    assert.deepEqual(fixed[3], []);
    assert.deepEqual(fixesFor(history[1], [history[1], pr(9, 'feat: mentions #2', '2026-10-21T10:00:00Z')]), []);
  });

  it('does not match #1 inside #12', () => {
    assert.deepEqual(fixesFor(history[0], [history[0], pr(12, 'fix: unrelated, see #12', '2026-10-21T10:00:00Z')]), []);
  });
});

describe('counts, rendering and the summary line', () => {
  const sorted = rows(history);
  const c = counts(sorted);

  it('counts the six-PR history by hand', () => {
    assert.deepEqual(c, { merged: 6, early: 1, noJudge: 4, unproven: 3, fixed: 2 });
  });

  it('orders rows by merge time', () => {
    assert.deepEqual(sorted.map((r) => r.number), [1, 2, 3, 4, 6, 5]);
  });

  it('prints the one line', () => {
    assert.equal(summaryLine(c), 'ledger: 6 merged, 1 merged before checks finished, 4 with no judge run, 3 acceptance lines with no proof, 2 fixed within 7 days');
  });

  it('renders a deterministic file ending in the summary', () => {
    const text = render(sorted);
    assert.equal(text, render(sorted));
    assert.match(text, /^# Escape ledger/);
    assert.match(text, /Window: 6 merged PRs, 2026-10-20 to 2026-10-30\./);
    assert.match(text, /\| #1 \| 2026-10-20 \| yes \| yes \| 1 \| #3 \|/);
    assert.ok(text.trimEnd().endsWith(summaryLine(c)));
  });

  it('renders an empty window', () => {
    assert.match(render([]), /Window: 0 merged PRs, none to none\./);
  });
});

describe('fetching through the injected gh', () => {
  it('asks for the last n, or for everything since a date, and passes the repo', () => {
    const seen = [];
    const io = { gh: (args) => { seen.push(args); return JSON.stringify(history); } };
    fetchMerged({ last: 10, io });
    fetchMerged({ since: '2026-10-01', repo: 'o/r', io });
    assert.deepEqual(seen[0].slice(0, 5), ['pr', 'list', '--state', 'merged', '--json']);
    assert.equal(seen[0][seen[0].indexOf('--limit') + 1], '100');
    assert.ok(!seen[0].includes('--search'));
    assert.equal(seen[1][seen[1].indexOf('--search') + 1], 'merged:>=2026-10-01');
    assert.equal(seen[1][seen[1].indexOf('--repo') + 1], 'o/r');
  });

  it('builds the ledger from the fixture, and an empty answer is an empty ledger', () => {
    const got = ledger({ last: 10, io: { gh: () => JSON.stringify(history) } });
    assert.equal(got.counts.merged, 6);
    assert.equal(got.summary, summaryLine(got.counts));
    assert.equal(ledger({ last: 10, io: { gh: () => '' } }).counts.merged, 0);
    assert.throws(() => ledger({ last: 10, io: { gh: () => '{}' } }), /list/);
  });
});

describe('review fixes', () => {
  const M = '2026-10-20T10:00:00Z';

  it('F1: a legacy commit status is finished unless pending or expected', () => {
    const ok = { context: 'vercel', state: 'SUCCESS', startedAt: '2026-10-20T09:00:00Z' };
    assert.equal(mergedEarly([ok], M), false);
    assert.equal(mergedEarly([{ ...ok, state: 'FAILURE' }], M), false);
    assert.equal(mergedEarly([{ ...ok, state: 'PENDING' }], M), true);
    assert.equal(mergedEarly([{ ...ok, state: 'EXPECTED' }], M), true);
    assert.equal(mergedEarly([{ context: 'codecov', state: 'SUCCESS', createdAt: '2026-10-20T10:30:00Z' }], M), false);
    assert.equal(mergedEarly([{ ...ok, state: 'SUCCESS', createdAt: '2026-10-20T09:30:00Z', startedAt: undefined }], M), false);
  });

  it('F2: a chunk id counts only as the first thing in the title\'s trailing parentheses', () => {
    const a = pr(1, 'feat: needs version 2.1 of the CLI (61.2)', '2026-10-20T10:00:00Z');
    const b = pr(2, 'fix: bump to version 2.1 (70.9)', '2026-10-21T10:00:00Z');
    const c = pr(3, 'fix: repair (61.2 review)', '2026-10-21T11:00:00Z');
    assert.deepEqual(fixesFor(a, [a, b, c]), [3]);
  });

  it('F3: a revert of a revert is not a fix of the original', () => {
    const a = pr(1, 'feat: thing (5.1)', '2026-10-20T10:00:00Z');
    const r = pr(2, 'Revert "feat: thing (5.1)"', '2026-10-21T10:00:00Z', { body: 'Reverts #1' });
    const rr = pr(3, 'Revert "Revert "feat: thing (5.1)""', '2026-10-22T10:00:00Z', { body: 'Reverts #2, restoring #1' });
    assert.deepEqual(fixesFor(a, [a, r, rr]), [2]);
  });

  it('F4: the last n are the n most recently merged, not the n most recently created', () => {
    const list = [pr(1, 'a', '2026-10-25T10:00:00Z'), pr(2, 'b', '2026-10-21T10:00:00Z'), pr(3, 'c', '2026-10-24T10:00:00Z'), pr(4, 'd', '2026-10-23T10:00:00Z')];
    const seen = [];
    const got = fetchMerged({ last: 2, io: { gh: (a) => { seen.push(a); return JSON.stringify(list); } } });
    assert.deepEqual(got.map((p) => p.number), [1, 3]);
    assert.ok(Number(seen[0][seen[0].indexOf('--limit') + 1]) > 2);
  });

  it('F5: closes reads semicolons and skips "of spec NN"', () => {
    assert.deepEqual(closedIds('Closes A1 of spec 61 and A2'), ['A1', 'A2']);
    assert.deepEqual(closedIds('Closes A1; A3.'), ['A1', 'A3']);
    assert.deepEqual(closedIds('Closes **A4** of spec 59 (chunk 59.4).'), ['A4']);
  });

  it('F6: a skipped, cancelled or neutral judge is not a judge run', () => {
    const j = (conclusion) => [{ name: 'judge', status: 'COMPLETED', conclusion, startedAt: '2026-10-20T09:00:00Z', completedAt: '2026-10-20T09:01:00Z' }];
    for (const x of ['SKIPPED', 'CANCELLED', 'NEUTRAL']) assert.equal(hadJudge(j(x), M), false, x);
    for (const x of ['SUCCESS', 'FAILURE']) assert.equal(hadJudge(j(x), M), true, x);
  });
});
