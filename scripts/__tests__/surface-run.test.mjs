// surface.mjs in scratch git repos (spec 64.1, A1): the surface leg's range walk end to end. A refine: or
// lessons: commit that touches a denied path or goes over a cap fails every time; a briefed chunk's commit
// to the same path passes. Also: non-ASCII paths, merges, a binary file, a cap split over two commits, a locked
// bearings section, and the fail-closed bases (no origin/main, shallow).
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { checkRange, commitsToCheck, loadSurface } from '../surface.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const { surface } = loadSurface(ROOT)

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf-8', stdio: 'pipe' })
const BEARINGS = ['# B', '', '## Locked', '', 'lock', '', '## Generators', '', 'g', ''].join('\n')

/** A repo whose origin/main is its first commit. */
function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'surface-'))
  git(dir, 'init', '-q', '-b', 'main')
  for (const [p, t] of [['agents.md', 'rules\n'], ['skills/next.md', 'next\n'], ['scripts/verify.mjs', '// v\n'], ['plan/bearings.md', BEARINGS]]) {
    fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true })
    fs.writeFileSync(path.join(dir, p), t)
  }
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', 'docs: base')
  git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
  return dir
}
function commit(dir, subject, file, text, mode = 'append') {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
  if (mode === 'append') fs.appendFileSync(path.join(dir, file), text)
  else fs.writeFileSync(path.join(dir, file), text)
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', subject)
  return git(dir, 'rev-parse', 'HEAD').trim()
}
const withScratch = (fn) => () => {
  const dir = scratch()
  try { fn(dir) } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}

describe('surface leg over scratch repos', () => {
  for (const verb of ['refine: march', 'lessons: sibling', 'Refine: march', 'refine!: march']) {
    for (const denied of ['agents.md', 'scripts/verify.mjs', '.claude/hooks/guard.mjs', '.github/workflows/night.yml', '.github/workflows/é.yml']) {
      it(`fails "${verb}" touching ${denied}, passes a briefed feat: to it`, withScratch((dir) => {
        commit(dir, verb, denied, 'edit\n')
        const red = checkRange(dir, surface)
        assert.equal(red.bound, 1)
        assert.equal(red.failures.length, 1, red.failures.join('\n'))
        assert.match(red.failures[0], /denied/)
        git(dir, 'reset', '-q', '--hard', 'HEAD~1')
        commit(dir, 'feat: briefed chunk', denied, 'edit\n')
        assert.deepEqual(checkRange(dir, surface).failures, [])
      }))
    }
  }

  it('fails over a cap, passes the same text under feat:', withScratch((dir) => {
    const big = 'z'.repeat(surface.caps['skills/*.md'] + 1)
    commit(dir, 'refine: x', 'skills/next.md', big + '\n')
    const red = checkRange(dir, surface)
    assert.equal(red.failures.length, 1)
    assert.match(red.failures[0], /cap/)
    git(dir, 'reset', '-q', '--hard', 'HEAD~1')
    commit(dir, 'feat: briefed chunk', 'skills/next.md', big + '\n')
    assert.deepEqual(checkRange(dir, surface).failures, [])
  }))

  it('sums the cap over the range: two commits cannot split it', withScratch((dir) => {
    const half = 'z'.repeat(Math.floor(surface.caps['skills/*.md'] / 2) + 10)
    commit(dir, 'refine: a', 'skills/next.md', half + '\n')
    assert.deepEqual(checkRange(dir, surface).failures, [])
    commit(dir, 'lessons: b', 'skills/next.md', half + '\n')
    const red = checkRange(dir, surface)
    assert.equal(red.failures.length, 1)
    assert.match(red.failures[0], /cap/)
  }))

  it('fails a binary change on a capped path', withScratch((dir) => {
    commit(dir, 'refine: x', 'skills/next.md', Buffer.from([0, 1, 2, 0, 255, 0]).toString('latin1'), 'write')
    fs.writeFileSync(path.join(dir, 'skills/next.md'), Buffer.from([0, 1, 2, 0, 255, 0, 9]))
    git(dir, 'add', '-A')
    git(dir, 'commit', '-qm', 'refine: y')
    assert.ok(checkRange(dir, surface).failures.some((f) => /binary/.test(f)))
  }))

  it('passes a refine: commit inside the surface and under the cap', withScratch((dir) => {
    commit(dir, 'refine: next', 'skills/next.md', 'one tightened line\n')
    assert.deepEqual(checkRange(dir, surface).failures, [])
  }))

  it('bearings: an allowed section passes; deleting a locked section or its heading fails', withScratch((dir) => {
    commit(dir, 'refine: gen', 'plan/bearings.md', BEARINGS.replace('\ng\n', '\ng\nmore\n'), 'write')
    assert.deepEqual(checkRange(dir, surface).failures, [])
    commit(dir, 'refine: del', 'plan/bearings.md', BEARINGS.replace('## Locked\n\nlock\n\n', ''), 'write')
    assert.equal(checkRange(dir, surface).failures.length, 1)
    git(dir, 'reset', '-q', '--hard', 'HEAD~1')
    commit(dir, 'refine: fold', 'plan/bearings.md', BEARINGS.replace('## Locked\n\nlock\n\n## Generators', '## Generators\n\nlock'), 'write')
    assert.equal(checkRange(dir, surface).failures.length, 1)
  }))

  it('walks merge-base..HEAD: a refine: commit beneath a merge is checked, and so is a refine: merge', withScratch((dir) => {
    git(dir, 'checkout', '-q', '-b', 'topic')
    commit(dir, 'refine: bad', 'agents.md', 'e\n')
    git(dir, 'checkout', '-q', 'main')
    commit(dir, 'feat: other', 'skills/next.md', 'o\n')
    git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
    git(dir, 'checkout', '-q', 'topic')
    git(dir, 'merge', '-q', '--no-ff', '-m', 'Merge main', 'main')
    const r = checkRange(dir, surface)
    assert.equal(commitsToCheck(dir).shas.length, 2)
    assert.equal(r.failures.length, 1)
    assert.match(r.failures[0], /agents\.md/)
  }))

  it('checks an evil refine: merge against its first parent', withScratch((dir) => {
    git(dir, 'checkout', '-q', '-b', 'topic')
    commit(dir, 'feat: side', 'skills/next.md', 's\n')
    git(dir, 'checkout', '-q', 'main')
    commit(dir, 'feat: main side', 'skills/other.md', 'm\n')
    git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
    git(dir, 'merge', '-q', '--no-ff', '--no-commit', 'topic')
    fs.appendFileSync(path.join(dir, 'agents.md'), 'evil\n')
    git(dir, 'add', '-A')
    git(dir, 'commit', '-qm', 'refine: merge topic')
    assert.ok(checkRange(dir, surface).failures.some((f) => /agents\.md/.test(f)))
  }))

  it('walks origin/main..HEAD, or HEAD alone when that is empty', withScratch((dir) => {
    assert.equal(commitsToCheck(dir).shas.length, 1)
    commit(dir, 'feat: a', 'skills/next.md', 'a\n')
    commit(dir, 'feat: b', 'skills/next.md', 'b\n')
    assert.equal(commitsToCheck(dir).shas.length, 2)
  }))

  it('honours GITHUB_BASE_REF', withScratch((dir) => {
    git(dir, 'update-ref', 'refs/remotes/origin/release', 'HEAD')
    commit(dir, 'refine: bad', 'agents.md', 'e\n')
    git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
    assert.equal(checkRange(dir, surface, { env: { GITHUB_BASE_REF: 'release' } }).failures.length, 1)
    git(dir, 'update-ref', 'refs/remotes/origin/release', 'HEAD')
    assert.equal(commitsToCheck(dir, { GITHUB_BASE_REF: 'release' }).shas.length, 1, 'base == HEAD: HEAD alone')
  }))

  it('fails closed when the base does not resolve', withScratch((dir) => {
    commit(dir, 'refine: bad', 'agents.md', 'e\n')
    git(dir, 'update-ref', '-d', 'refs/remotes/origin/main')
    const r = checkRange(dir, surface)
    assert.equal(r.failures.length, 1)
    assert.match(r.failures[0], /does not resolve/)
    assert.equal(checkRange(dir, surface, { env: { GITHUB_BASE_REF: 'nope' } }).failures.length, 1)
  }))

  it('fails closed on a shallow clone', () => {
    const src = scratch()
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'surface-shallow-'))
    try {
      commit(src, 'feat: a', 'skills/next.md', 'a\n')
      commit(src, 'refine: bad', 'agents.md', 'e\n')
      fs.rmSync(dir, { recursive: true, force: true })
      execFileSync('git', ['clone', '-q', '--depth', '1', pathToUrl(src), dir], { stdio: 'pipe' })
      const r = checkRange(dir, surface)
      assert.equal(r.failures.length, 1)
      assert.match(r.failures[0], /shallow/)
    } finally {
      fs.rmSync(src, { recursive: true, force: true })
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

const pathToUrl = (p) => `file://${p.startsWith('/') ? '' : '/'}${p.replace(/\\/g, '/')}`
