// The field-research generator (spec 59, A3) and its rules (scripts/plan/field.mjs): a batch is at most 3 candidates
// and 8 fetches, with no URL and no product name in candidate text; a field candidate is filed at the floor, a known
// pattern is re-evidenced instead of filed again, sources reach the job summary only, a dry run writes nothing, a
// second --write files nothing; the gate fails a field candidate that carries a URL. Fixtures only: nothing is
// fetched. node:test, no deps.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { FIELD_CEILING, FIELD_SCORE, candidateRow, checkFieldCandidates, known, namesIn, parseTopics, urlsIn, validateBatch } from '../plan/field.mjs';
import { apply, brief, main } from '../generators/research.mjs';
import { stamps } from '../plan/refill.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TODAY = '2026-10-27';
const CANDS = '# Candidates\n\n> Last pass: 2026-10-20\n\n## Pending\n\n## Promoted\n\n## Rejected\n';

const item = (over = {}) => ({
  title: 'A hosted agent platform resumes runs across machines',
  pattern: 'long agent runs survive a machine loss by checkpointing state somewhere the next machine can read',
  rationale: 'the kit parks a loop on reboot but cannot resume it elsewhere',
  scope: 'a ledger the next machine reads, so a parked run resumes without the owner',
  ...over,
});
const batch = (items = [item()], over = {}) => ({ fetched: 3, sources: ['https://example.com/a', 'https://example.org/b'], items, ...over });

function tmpRepo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'research-'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}
const bearings = (...lines) => `# Bearings\n\n## Plan expansion posture\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`;
const capture = (fn) => {
  const out = [];
  const err = console.error;
  const errs = [];
  console.error = (m) => errs.push(m);
  let code;
  try { code = fn((l) => out.push(l)); } finally { console.error = err; }
  return { code, out: out.join('\n'), last: out[out.length - 1], err: errs.join('\n') };
};
const run = (root, argv, env = {}) => capture((log) => main(argv, { root, log, env }));
const writeBatch = (root, b, name = 'batch.json') => { fs.writeFileSync(path.join(root, name), JSON.stringify(b)); return name; };
const cands = (root) => fs.readFileSync(path.join(root, 'plan', 'CANDIDATES.md'), 'utf8');

describe('urlsIn', () => {
  it('finds schemes, www hosts, bare hosts on common TLDs and markdown link targets', () => {
    assert.ok(urlsIn('see https://example.com/post').length);
    assert.ok(urlsIn('at www.vendor.net now').length);
    assert.ok(urlsIn('docs live at vendor.dev/guide').length);
    assert.ok(urlsIn('a [post](notes/x) link').length);
  });
  it('leaves plain prose and file names alone', () => {
    assert.deepEqual(urlsIn('a loop resumes runs across machines, e.g. after a reboot.'), []);
    assert.deepEqual(urlsIn('edit scripts/plan/field.mjs and run.sh'), []);
  });
});

describe('namesIn', () => {
  it('flags the denylist, case-insensitively, as whole words', () => {
    assert.deepEqual(namesIn('the loop uses claude to review'), ['claude']);
    assert.ok(namesIn('ask GitHub Copilot').includes('Copilot'));
    assert.deepEqual(namesIn('a gitlab-style runner'), ['gitlab-style']);
  });
  it('flags a capitalised word mid-sentence that no list knows', () => {
    assert.deepEqual(namesIn('a hosted platform called Zephyrix resumes runs'), ['Zephyrix']);
    assert.deepEqual(namesIn('agents built with FooKit stay small'), ['FooKit']);
    assert.deepEqual(namesIn('the new Orbit-2 runner ships weekly'), ['Orbit-2']);
  });
  it('lets a sentence-opening capital, trade acronyms and plain lowercase prose through', () => {
    assert.deepEqual(namesIn('A hosted agent platform resumes runs across machines'), []);
    assert.deepEqual(namesIn('CI runs a PR check over the CLI and an MCP server.\nThe API stays small.'), []);
  });
  it('takes extra names to deny', () => {
    assert.deepEqual(namesIn('the loop uses quillbot to polish', ['quillbot']), ['quillbot']);
  });
});

describe('validateBatch', () => {
  it('accepts a clean batch, and an empty one', () => {
    assert.deepEqual(validateBatch(batch()), { ok: true, errors: [] });
    assert.equal(validateBatch(batch([])).ok, true);
  });
  it('refuses a fourth candidate', () => {
    const items = [1, 2, 3, 4].map((n) => item({ title: `Pattern number ${'x'.repeat(n)} agents` }));
    const r = validateBatch(batch(items));
    assert.equal(r.ok, false);
    assert.match(r.errors.join('\n'), /4 candidates; at most 3/);
    assert.equal(validateBatch(batch(items.slice(0, 3))).ok, true);
  });
  it('refuses a ninth fetch, in the count or the list', () => {
    assert.match(validateBatch(batch([item()], { fetched: 9 })).errors.join('\n'), /fetched 9 sources; at most 8/);
    const sources = Array.from({ length: 9 }, (_, n) => `https://example.com/${n}`);
    assert.match(validateBatch(batch([item()], { fetched: 8, sources })).errors.join('\n'), /9 sources listed/);
    assert.equal(validateBatch(batch([item()], { fetched: 8, sources: sources.slice(0, 8) })).ok, true);
  });
  it('refuses a URL in any candidate field', () => {
    for (const k of ['title', 'pattern', 'rationale', 'scope', 'chunks']) {
      const r = validateBatch(batch([item({ [k]: 'resumes runs, see https://example.com/post' })]));
      assert.match(r.errors.join('\n'), new RegExp(`${k} carries a URL`), k);
    }
  });
  it('refuses a product name in any candidate field', () => {
    const r = validateBatch(batch([item({ rationale: 'Cursor ships this already' })]));
    assert.match(r.errors.join('\n'), /rationale names a product or vendor \(Cursor\)/);
    assert.match(validateBatch(batch([item({ pattern: 'a platform named Zephyrix resumes runs' })])).errors.join('\n'), /Zephyrix/);
  });
  it('refuses a source other than field, a multi-line or over-long title, and a missing field', () => {
    assert.match(validateBatch(batch([item({ source: 'audit' })])).errors.join('\n'), /source must be field/);
    assert.match(validateBatch(batch([item({ title: 'two\nlines' })])).errors.join('\n'), /one non-empty line/);
    assert.match(validateBatch(batch([item({ title: 'x'.repeat(121) })])).errors.join('\n'), /at most 120/);
    assert.match(validateBatch(batch([item({ scope: '' })])).errors.join('\n'), /scope must be a non-empty string/);
    assert.equal(validateBatch(null).ok, false);
  });
});

describe('parseTopics', () => {
  it('reads the semicolon-separated phrases, ignoring comments and code blocks', () => {
    const b = '## Plan expansion posture\n\n- Research: weekly\n- Research topics: agent loops; spec-driven kits ; AI review in CI\n';
    assert.deepEqual(parseTopics(b), ['agent loops', 'spec-driven kits', 'AI review in CI']);
    assert.deepEqual(parseTopics('<!-- Research topics: hidden -->\n```\nResearch topics: fenced\n```\n'), []);
    assert.deepEqual(parseTopics('nothing here'), []);
  });
});

describe('known', () => {
  it('matches a restated title and not an unrelated one', () => {
    const t = ['A hosted agent platform resumes runs across machines'];
    assert.equal(known('Hosted agent platforms resume runs across machines', t), t[0]);
    assert.equal(known('Review comments become tracked tasks', t), null);
  });
});

describe('the candidate row', () => {
  it('is a field candidate at the floor, stamped for refill, with no URL', () => {
    const lines = candidateRow(item(), TODAY);
    const text = lines.join('\n');
    assert.match(lines[0], new RegExp(`^### \\[ \\] \\[score ${FIELD_SCORE.toFixed(1)}\\] A hosted agent platform`));
    assert.match(text, /- source signals: field \(2026-10-27\): long agent runs/);
    assert.deepEqual(stamps(text), [{ name: 'research', date: TODAY, pending: false }]);
    assert.deepEqual(urlsIn(text), []);
    assert.ok(FIELD_SCORE < FIELD_CEILING);
  });
});

describe('apply', () => {
  const INTERNAL = CANDS.replace('## Pending\n', '## Pending\n\n### [ ] [score 5.0] Hosted agent platforms resume runs across machines\n- proposed: 2026-10-01\n- source signals: AUDIT rows (2026-10-01): three parked loops never resumed\n- rationale: x\n');
  it('files a new pattern, and never re-evidences its own field row (a second run is a no-op)', () => {
    const first = apply(CANDS, [item()], { date: TODAY });
    assert.deepEqual(first.filed, [item().title]);
    const again = apply(first.text, [item({ title: 'Hosted agent platforms resume runs across machines' })], { date: '2026-11-03' });
    assert.equal(again.text, first.text);
    assert.deepEqual(again.filed, []);
    assert.match(again.skipped.join('\n'), /restates a field candidate/);
  });
  it('re-evidences an internal candidate once, then no more', () => {
    const again = apply(INTERNAL, [item()], { date: '2026-11-03' });
    assert.deepEqual(again.filed, []);
    assert.equal(again.reevidenced.length, 1);
    assert.match(again.text, /\[score 5\.5\] Hosted agent platforms/);
    assert.match(again.text, /- re-evidence:\n {2}- 2026-11-03 · E · independent/);
    const third = apply(again.text, [item()], { date: '2026-11-10' });
    assert.equal(third.text, again.text);
    assert.match(third.skipped.join('\n'), /already evidenced/);
  });
  it('honours the limit and an in-batch restatement', () => {
    const items = [item({ title: 'First distinct pattern of review loops' }), item({ title: 'Second distinct pattern of cache keys' }), item({ title: 'Third unrelated pattern about onboarding flows' })];
    const r = apply(CANDS, items, { date: TODAY, limit: 2 });
    assert.equal(r.filed.length, 2);
    assert.match(r.skipped.join('\n'), /over the limit of 2/);
    const dup = apply(CANDS, [item(), item({ title: 'Hosted agent platforms resume runs across machines' })], { date: TODAY });
    assert.equal(dup.filed.length, 1);
    assert.match(dup.skipped.join('\n'), /restates one filed in this batch/);
  });
});

describe('the generator', () => {
  const repo = (...b) => tmpRepo({ 'plan/bearings.md': bearings(...b, 'Research topics: agent loops; spec kits'), 'plan/CANDIDATES.md': CANDS });

  it('does nothing under Research: off, with or without a batch', () => {
    const root = repo('Research: off');
    const r = run(root, ['--today', TODAY]);
    assert.equal(r.code, 0);
    assert.equal(r.last, 'clean');
    assert.match(r.out, /research off/);
    const b = writeBatch(root, batch());
    assert.equal(run(root, ['--batch', b, '--write', '--today', TODAY]).last, 'clean');
    assert.equal(cands(root), CANDS);
  });

  it('reads the dial: bold means weekly, gentle means off', () => {
    assert.match(run(repo('Improve: bold'), ['--today', TODAY]).out, /research due \(weekly\)/);
    assert.match(run(repo('Improve: steady'), ['--today', TODAY]).out, /research due \(monthly\)/);
    assert.match(run(repo('Improve: gentle'), ['--today', TODAY]).out, /research off/);
    assert.match(run(repo('Improve: gentle', 'Research: weekly'), ['--today', TODAY]).out, /research due \(weekly\)/);
  });

  it('without a batch prints due or not due by cadence, then clean, and writes nothing', () => {
    const root = repo('Research: weekly');
    assert.match(run(root, ['--today', TODAY]).out, /research due \(weekly\)/);
    const b = writeBatch(root, batch());
    run(root, ['--batch', b, '--write', '--today', TODAY]);
    const before = cands(root);
    const soon = run(root, ['--today', '2026-10-30']);
    assert.match(soon.out, /research not due: last filed 2026-10-27/);
    assert.equal(soon.last, 'clean');
    assert.match(run(root, ['--today', '2026-11-03']).out, /research due/);
    assert.equal(cands(root), before);
  });

  it('--brief carries the topics and the caps', () => {
    const r = run(repo('Research: weekly'), ['--brief']);
    assert.match(r.out, /topics: agent loops \| spec kits/);
    assert.match(r.out, /at most 8 pages/);
    assert.match(r.out, /at most 3 items/);
    assert.match(r.out, /untrusted data/);
    assert.equal(r.last, 'clean');
    assert.ok(brief([], 'weekly').join('\n').includes('Research topics:'));
  });

  it('a dry run writes nothing; --write files one field candidate; a second --write files nothing', () => {
    const root = repo('Research: weekly');
    const b = writeBatch(root, batch());
    const dry = run(root, ['--batch', b, '--today', TODAY]);
    assert.match(dry.last, /^filed 1 \(dry run\)$/);
    assert.equal(cands(root), CANDS);
    const w = run(root, ['--batch', b, '--write', '--today', TODAY]);
    assert.equal(w.code, 0);
    assert.equal(w.last, 'filed 1');
    const text = cands(root);
    assert.match(text, /### \[ \] \[score 4\.0\] A hosted agent platform resumes runs across machines/);
    assert.match(text, /- source signals: field \(2026-10-27\):/);
    assert.deepEqual(checkFieldCandidates(text), []);
    const again = run(root, ['--batch', b, '--write', '--today', TODAY]);
    assert.equal(again.last, 'clean');
    assert.equal(cands(root), text);
  });

  it('refuses a bad batch whole: exit 1, nothing written, the reason on stderr', () => {
    const root = repo('Research: weekly');
    const bad = writeBatch(root, batch([item(), item({ title: 'Another pattern about cache keys in agents', pattern: 'see https://example.com/x' })]));
    const r = run(root, ['--batch', bad, '--write', '--today', TODAY]);
    assert.equal(r.code, 1);
    assert.match(r.err, /refused: item 2: pattern carries a URL/);
    assert.equal(cands(root), CANDS);
    assert.equal(run(root, ['--batch', 'missing.json', '--today', TODAY]).code, 1);
  });

  it('files at most 3, and at most --limit', () => {
    const root = repo('Research: weekly');
    const items = [item({ title: 'Review loops catch drift early' }), item({ title: 'Cache keys follow content hashes' }), item({ title: 'Onboarding flows ask once' })];
    const b = writeBatch(root, batch(items));
    assert.equal(run(root, ['--batch', b, '--write', '--limit', '2', '--today', TODAY]).last, 'filed 2');
    assert.equal(run(root, ['--batch', b, '--write', '--limit', '9', '--today', TODAY]).last, 'filed 1');
    assert.equal((cands(root).match(/^### /gm) ?? []).length, 3);
  });

  it('puts the sources in the job summary only, never in the queue or the log', () => {
    const root = repo('Research: weekly');
    const summary = path.join(root, 'summary.md');
    const b = writeBatch(root, batch());
    const r = run(root, ['--batch', b, '--write', '--today', TODAY], { GITHUB_STEP_SUMMARY: summary });
    assert.match(fs.readFileSync(summary, 'utf8'), /- https:\/\/example\.com\/a/);
    assert.doesNotMatch(cands(root), /example\.(com|org)/);
    assert.doesNotMatch(r.out, /https?:/);
    const dry = path.join(root, 'dry.md');
    run(root, ['--batch', b, '--today', TODAY], { GITHUB_STEP_SUMMARY: dry });
    assert.equal(fs.existsSync(dry), false);
  });

  it('runs as a script: usage 64, the generator contract line', () => {
    const root = repo('Research: weekly');
    const bad = spawnSync(process.execPath, [path.join(KIT, 'generators', 'research.mjs'), '--today', 'soon'], { cwd: root, encoding: 'utf8' });
    assert.equal(bad.status, 64);
    const ok = spawnSync(process.execPath, [path.join(KIT, 'generators', 'research.mjs'), '--today', TODAY], { cwd: root, encoding: 'utf8' });
    assert.equal(ok.status, 0);
    assert.match(ok.stdout.trim().split('\n').pop(), /^(?:filed \d+|clean)$/);
  });
});

describe('the gate: checkFieldCandidates', () => {
  const row = (extra = '') => `### [ ] [score 4.0] A pattern about resumable runs
- proposed: 2026-10-27
- source signals: field (2026-10-27): runs resume across machines${extra}
- rationale: the kit parks a loop but cannot resume it.
- proposed scope: a ledger.
`;
  it('passes a clean field candidate and a non-field candidate with a URL', () => {
    assert.deepEqual(checkFieldCandidates(`## Pending\n\n${row()}`), []);
    const audit = '### [ ] [score 7.0] Workflow lane\n- source signals: AUDIT rows, see https://example.com/issue\n';
    assert.deepEqual(checkFieldCandidates(`## Pending\n\n${audit}`), []);
  });
  it('fails a field candidate whose signal, rationale or title carries a URL', () => {
    const f = checkFieldCandidates(`## Pending\n\n${row(' (see https://example.com/post)')}`);
    assert.equal(f.length, 1);
    assert.match(f[0], /field candidate "A pattern about resumable runs" carries a URL/);
    assert.equal(checkFieldCandidates(`## Pending\n\n${row().replace('a loop.', 'a loop.').replace('a ledger.', 'a ledger at vendor.dev/x.')}`).length, 1);
    assert.equal(checkFieldCandidates(`## Pending\n\n${row().replace('A pattern', 'A www.vendor.net pattern')}`).length, 1);
  });
  it('catches a research-stamped row even when its signal line was reworded', () => {
    const r = row().replace('field (2026-10-27)', 'something').replace('- proposed scope: a ledger.', '- proposed scope: a ledger, see https://example.com/z\n- generator: research · filed 2026-10-27');
    assert.equal(checkFieldCandidates(r).length, 1);
  });
});
