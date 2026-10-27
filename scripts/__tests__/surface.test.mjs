// surface.mjs (spec 64.1, A1): the pure half. Globs, the patch parser and checkCommit on canned patches; the
// scratch-repo half is surface-run.test.mjs. A denied path or an over-cap commit fails every time; the same
// patch under a briefed subject passes.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { checkCommit, globToRegExp, loadSurface, parsePatch } from '../surface.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const { surface, problems } = loadSurface(ROOT)

const patchFor = (file, added, at = 1) =>
  `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -${at},0 +${at},${added.length} @@\n${added.map((l) => `+${l}`).join('\n')}\n`

describe('surface.json', () => {
  it('exists and parses', () => {
    assert.deepEqual(problems, [])
    assert.ok(surface.allow.length && surface.deny.length && Object.keys(surface.caps).length)
  })
  it('denies the always-forbidden paths and allows the named ones', () => {
    for (const p of ['.claude/hooks/guard.mjs', '.claude/settings.json', '.github/workflows/night.yml', 'scripts/verify.mjs', 'scripts/pr/open.mjs', 'agents.md']) {
      assert.equal(checkCommit({ subject: 'refine: march', patch: patchFor(p, ['x']), readNew: () => '' }, surface).length, 1, p)
    }
    for (const p of ['skills/next.md', 'skills/next.lanes.md', 'identity/footguns.md']) {
      assert.deepEqual(checkCommit({ subject: 'lessons: a', patch: patchFor(p, ['x']), readNew: () => '' }, surface), [], p)
    }
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

describe('parsePatch', () => {
  it('counts added characters per file and reads hunks', () => {
    const [f] = parsePatch(patchFor('skills/a.md', ['abc', 'de'], 4))
    assert.equal(f.path, 'skills/a.md')
    assert.equal(f.added, 4 + 3)
    assert.deepEqual(f.hunks, [{ start: 4, count: 2 }])
  })
})

describe('checkCommit', () => {
  const bearings = ['# B', '', '## Locked', '', 'a', '', '## Generators', '', 'g', ''].join('\n')
  it('fails a path outside the allow-list, whatever the verb in the bound set', () => {
    for (const subject of ['refine: x', 'lessons: y', 'refine(skills): x']) {
      assert.equal(checkCommit({ subject, patch: patchFor('README.md', ['x']), readNew: () => '' }, surface).length, 1, subject)
    }
  })
  it('fails over a cap and passes at it', () => {
    const cap = surface.caps['skills/*.md']
    const over = [ 'y'.repeat(cap) ]
    assert.equal(checkCommit({ subject: 'refine: x', patch: patchFor('skills/a.md', over), readNew: () => '' }, surface).length, 1)
    const at = [ 'y'.repeat(cap - 1) ]
    assert.deepEqual(checkCommit({ subject: 'refine: x', patch: patchFor('skills/a.md', at), readNew: () => '' }, surface), [])
  })
  it('the lanes cap wins over the skills cap for a lanes file', () => {
    const big = ['y'.repeat(surface.caps['skills/*.lanes.md'])]
    assert.equal(checkCommit({ subject: 'lessons: x', patch: patchFor('skills/a.lanes.md', big), readNew: () => '' }, surface).length, 1)
  })
  it('allows an allowed bearings section and fails a locked one', () => {
    const ok = checkCommit({ subject: 'refine: x', patch: patchFor('plan/bearings.md', ['g2'], 9), readNew: () => bearings }, surface)
    assert.deepEqual(ok, [])
    const bad = checkCommit({ subject: 'refine: x', patch: patchFor('plan/bearings.md', ['a2'], 5), readNew: () => bearings }, surface)
    assert.equal(bad.length, 1)
    assert.match(bad[0], /Locked/)
  })
  it('does not inspect a briefed chunk commit to the same paths', () => {
    for (const p of ['scripts/verify.mjs', 'agents.md', 'README.md', 'skills/a.md']) {
      assert.deepEqual(checkCommit({ subject: 'feat: x', patch: patchFor(p, ['y'.repeat(99999)]), readNew: () => '' }, surface), [], p)
    }
  })
  it('does not bind a subject that merely contains the verb', () => {
    assert.deepEqual(checkCommit({ subject: 'docs: refine: the gate', patch: patchFor('agents.md', ['x']), readNew: () => '' }, surface), [])
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
