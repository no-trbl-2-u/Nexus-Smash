// surface.mjs in scratch git repos (spec 64.1, A1): the surface leg's range walk end to end. A refine: or
// lessons: commit that touches a denied path or goes over a cap fails every time; a briefed chunk's commit
// to the same path passes.
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

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'surface-'))
  git(dir, 'init', '-q')
  for (const [p, t] of [['agents.md', 'rules\n'], ['skills/next.md', 'next\n'], ['scripts/verify.mjs', '// v\n']]) {
    fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true })
    fs.writeFileSync(path.join(dir, p), t)
  }
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', 'docs: base')
  return dir
}
function commit(dir, subject, file, text) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
  fs.appendFileSync(path.join(dir, file), text)
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', subject)
  return git(dir, 'rev-parse', 'HEAD').trim()
}

describe('surface leg over scratch repos', () => {
  for (const verb of ['refine: march', 'lessons: sibling']) {
    for (const denied of ['agents.md', 'scripts/verify.mjs', '.claude/hooks/guard.mjs', '.github/workflows/night.yml']) {
      it(`fails "${verb}" touching ${denied}, passes a briefed feat: to it`, () => {
        const dir = scratch()
        try {
          commit(dir, verb, denied, 'edit\n')
          const red = checkRange(dir, surface)
          assert.equal(red.bound, 1)
          assert.equal(red.failures.length, 1, red.failures.join('\n'))
          assert.match(red.failures[0], /denied/)
          git(dir, 'reset', '-q', '--hard', 'HEAD~1')
          commit(dir, 'feat: briefed chunk', denied, 'edit\n')
          assert.deepEqual(checkRange(dir, surface).failures, [])
        } finally { fs.rmSync(dir, { recursive: true, force: true }) }
      })
    }
    it(`fails "${verb}" over a cap, passes the same text under feat:`, () => {
      const dir = scratch()
      try {
        const big = 'z'.repeat(surface.caps['skills/*.md'] + 1)
        commit(dir, verb, 'skills/next.md', big + '\n')
        const red = checkRange(dir, surface)
        assert.equal(red.failures.length, 1)
        assert.match(red.failures[0], /cap/)
        git(dir, 'reset', '-q', '--hard', 'HEAD~1')
        commit(dir, 'feat: briefed chunk', 'skills/next.md', big + '\n')
        assert.deepEqual(checkRange(dir, surface).failures, [])
      } finally { fs.rmSync(dir, { recursive: true, force: true }) }
    })
  }

  it('passes a refine: commit inside the surface and under the cap', () => {
    const dir = scratch()
    try {
      commit(dir, 'refine: next', 'skills/next.md', 'one tightened line\n')
      assert.deepEqual(checkRange(dir, surface).failures, [])
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })

  it('walks origin/main..HEAD when it names commits, else HEAD alone', () => {
    const dir = scratch()
    try {
      const bad = commit(dir, 'refine: x', 'agents.md', 'e\n')
      assert.deepEqual(commitsToCheck(dir), [bad]) // no origin/main: HEAD alone
      git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD~1')
      commit(dir, 'feat: later', 'skills/next.md', 'l\n')
      const r = checkRange(dir, surface) // the refine: commit is inside origin/main..HEAD, one behind the tip
      assert.equal(commitsToCheck(dir).length, 2)
      assert.equal(r.failures.length, 1)
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
})
