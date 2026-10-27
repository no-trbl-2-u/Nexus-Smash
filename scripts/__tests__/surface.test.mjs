// surface.mjs (spec 64.1, A1): the pure half. Globs, addedChars, section checks and checkCommit on canned file
// facts; the scratch-repo half is surface-run.test.mjs. A denied path or an over-cap commit fails every time;
// the same facts under a briefed subject pass.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { BOUND, addedChars, checkCommit, globToRegExp, loadSurface, sectionProblems } from '../surface.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const { surface, problems } = loadSurface(ROOT)

const file = (p, added = 1, extra = {}) => ({ path: p, added, binary: false, ...extra })
const check = (subject, files, texts = {}, totals = {}) =>
  checkCommit({ subject, files, readOld: (p) => texts[p]?.[0] ?? null, readNew: (p) => texts[p]?.[1] ?? null }, surface, totals)

describe('surface.json', () => {
  it('exists and parses', () => {
    assert.deepEqual(problems, [])
    assert.ok(surface.allow.length && surface.deny.length && Object.keys(surface.caps).length)
  })
  it('denies the always-forbidden paths (including non-ASCII ones) and allows the named ones', () => {
    for (const p of ['.claude/hooks/guard.mjs', '.claude/settings.json', '.github/workflows/night.yml', '.github/workflows/é.yml', 'scripts/verify.mjs', 'scripts/pr/open.mjs', 'agents.md']) {
      assert.equal(check('refine: march', [file(p)]).length, 1, p)
    }
    for (const p of ['skills/next.md', 'skills/next.lanes.md', 'identity/footguns.md']) assert.deepEqual(check('lessons: a', [file(p)]), [], p)
  })
})

describe('globToRegExp', () => {
  it('keeps * in a segment and lets ** cross them', () => {
    assert.ok(globToRegExp('skills/*.md').test('skills/a.md'))
    assert.ok(!globToRegExp('skills/*.md').test('skills/x/a.md'))
    assert.ok(globToRegExp('.github/**').test('.github/workflows/a.yml'))
    assert.ok(!globToRegExp('scripts/verify.mjs').test('scripts/verifyxmjs'))
  })
})

describe('subject binding', () => {
  it('over-binds case and punctuation variants, not other verbs', () => {
    for (const s of ['refine: x', 'Refine: x', 'REFINE: x', 'refine!: x', 'refine : x', ' refine: x', 'refine(skills): x', 'lessons: y', 'Lessons - y']) assert.ok(BOUND.test(s), s)
    for (const s of ['feat: x', 'docs: refine: the gate', 'refinery: x', 'plan: lessons']) assert.ok(!BOUND.test(s), s)
  })
  it('fails a denied path under every variant', () => {
    for (const s of ['Refine: x', 'refine!: x', 'refine : x', 'LESSONS: y']) assert.equal(check(s, [file('agents.md')]).length, 1, s)
  })
})

describe('addedChars', () => {
  it('counts added lines after the first hunk, not header lines', () => {
    const patch = 'diff --git a/s b/s\n--- a/s\n+++ b/s\n@@ -1,0 +1,2 @@\n+abc\n+de\n'
    assert.equal(addedChars(patch), 4 + 3)
    assert.equal(addedChars('diff --git a/s b/s\n--- a/s\n+++ b/s\n@@ -1 +1 @@\n-x\n++++ y\n'), 6) // a content line starting "+++" still counts
  })
})

describe('checkCommit', () => {
  it('fails a path outside the allow-list', () => {
    for (const subject of ['refine: x', 'lessons: y', 'refine(skills): x']) assert.equal(check(subject, [file('README.md')]).length, 1, subject)
  })
  it('fails over a cap and passes at it', () => {
    const cap = surface.caps['skills/*.md']
    assert.equal(check('refine: x', [file('skills/a.md', cap + 1)]).length, 1)
    assert.deepEqual(check('refine: x', [file('skills/a.md', cap)]), [])
  })
  it('sums a file across commits: two half-cap-plus commits fail', () => {
    const cap = surface.caps['skills/*.md']
    const totals = {}
    assert.deepEqual(check('refine: a', [file('skills/a.md', cap - 10)], {}, totals), [])
    assert.equal(check('lessons: b', [file('skills/a.md', 20)], {}, totals).length, 1)
    assert.equal(check('refine: c', [file('skills/a.md', 20)], {}, totals).length, 0, 'reported once, by the commit that crosses')
    assert.deepEqual(check('refine: d', [file('skills/other.md', cap)], {}, totals), [], 'another file has its own budget')
  })
  it('a briefed commit in the range does not spend the budget', () => {
    const cap = surface.caps['skills/*.md']
    const totals = {}
    assert.deepEqual(check('feat: big', [file('skills/a.md', cap * 3)], {}, totals), [])
    assert.deepEqual(check('refine: x', [file('skills/a.md', cap)], {}, totals), [])
  })
  it('the lanes cap wins over the skills cap for a lanes file', () => {
    assert.equal(check('lessons: x', [file('skills/a.lanes.md', surface.caps['skills/*.lanes.md'] + 1)]).length, 1)
  })
  it('a binary change on a capped path fails', () => {
    assert.equal(check('refine: x', [file('skills/a.md', 0, { binary: true })]).length, 1)
  })
  it('does not inspect a briefed chunk commit to the same paths', () => {
    for (const p of ['scripts/verify.mjs', 'agents.md', 'README.md', 'skills/a.md']) assert.deepEqual(check('feat: x', [file(p, 99999)]), [], p)
  })
  it('does not bind a subject that merely contains the verb', () => {
    assert.deepEqual(check('docs: refine: the gate', [file('agents.md')]), [])
  })
})

describe('bearings sections', () => {
  const old = ['# B', '', 'intro', '', '## Locked', '', 'lock', '', '## Generators', '', 'g', '', '## Plan expansion posture', '', 'p', ''].join('\n')
  const run = (neu) => check('refine: x', [file('plan/bearings.md')], { 'plan/bearings.md': [old, neu] })
  it('allows a change inside an allowed section', () => {
    assert.deepEqual(run(old.replace('\ng\n', '\ng\nmore\n')), [])
    assert.deepEqual(run(old.replace('\np\n', '\np2\n')), [])
  })
  it('fails a change in a locked section or above the first heading', () => {
    assert.match(run(old.replace('lock', 'lock2'))[0], /Locked/)
    assert.match(run(old.replace('intro', 'intro2'))[0], /above the first heading/)
  })
  it('fails deleting a locked section, entire', () => {
    const neu = old.replace('## Locked\n\nlock\n\n', '')
    assert.equal(run(neu).length, 1)
    assert.match(run(neu)[0], /heading|Locked/)
  })
  it('fails deleting just a locked heading to fold its body into an allowed one', () => {
    const neu = old.replace('## Locked\n\nlock\n\n## Generators', '## Generators\n\nlock')
    assert.ok(run(neu).length >= 1)
    assert.match(sectionProblems(old, neu, ['Generators', 'Plan expansion posture']).join(';'), /heading/)
  })
  it('fails adding a heading, even inside an allowed section', () => {
    assert.equal(run(old.replace('\ng\n', '\ng\n\n## Sneaky\n\nx\n')).length, 1)
  })
  it('fails a binary or a deleted bearings file', () => {
    assert.equal(check('refine: x', [file('plan/bearings.md', 0, { binary: true })]).length, 1)
    assert.equal(check('refine: x', [file('plan/bearings.md')], { 'plan/bearings.md': [old, null] }).length, 1)
  })
})

describe('the committed surface.json', () => {
  it('names bearings sections that exist', () => {
    const text = fs.readFileSync(path.join(ROOT, 'plan/bearings.md'), 'utf-8')
    for (const g of surface.allow.filter((a) => a.startsWith('plan/bearings.md#'))) {
      assert.match(text, new RegExp(`^## ${g.slice(g.indexOf('#') + 1)}\\s*$`, 'm'), g)
    }
  })
})
