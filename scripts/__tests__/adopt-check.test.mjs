// adopt-check (spec 60, A5): the pure parts of the clean-adoption check.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { drift, hashOf, matchesTemplate, pollution, substantive, upstreamHits, vocabularyFrom } from '../adopt-check.mjs'

const KIT = { repo: 'acme/fork', upstream: 'Elder/Kit', package: '@acme/cli', docs: 'https://example.test' }
const SCOPE = '@elderscope/'
const files = (o) => new Map(Object.entries(o).map(([k, v]) => [k, Buffer.from(v)]))

test('hashOf ignores line endings', () => {
  assert.equal(hashOf(Buffer.from('a\r\nb\r\n')), hashOf(Buffer.from('a\nb\n')))
  assert.notEqual(hashOf('a\n'), hashOf('b\n'))
})

test('substantive skips empty and whitespace-only files', () => {
  assert.equal(substantive(Buffer.from('')), false)
  assert.equal(substantive(Buffer.from(' \n\t')), false)
  assert.equal(substantive(Buffer.from('x')), true)
})

test('vocabularyFrom reads the Set out of verify.mjs text, comments left out', () => {
  const v = vocabularyFrom("const PLACEHOLDER_VOCABULARY = new Set([\n  // '<OLD>' note\n  '<PROJECT>', '<REPO_SLUG>',\n  '<CANONICAL SIBLING>',\n])")
  assert.deepEqual([...v].sort(), ['<CANONICAL SIBLING>', '<PROJECT>', '<REPO_SLUG>'])
  assert.equal(vocabularyFrom('nothing here'), null)
})

test('matchesTemplate: equal, substituted, and drifted', () => {
  const vocab = new Set(['<PROJECT>', '<REPO_SLUG>'])
  const t = 'Run <PROJECT> from <REPO_SLUG>.\nsame line\n'
  assert.deepEqual(matchesTemplate(t, t, vocab), { ok: true })
  assert.deepEqual(matchesTemplate(t, 'Run greet from me/greet.\r\nsame line\r\n', vocab), { ok: true })
  const r = matchesTemplate(t, 'Run greet from me/greet.\nchanged line\n', vocab)
  assert.equal(r.ok, false)
  assert.equal(r.line, 2)
  assert.equal(matchesTemplate(t, 'Run greet everywhere\nsame line\n', vocab).ok, false)
  assert.equal(matchesTemplate(t, 'Run greet from me/greet.\nsame line\nextra\n', vocab).ok, false)
})

test('matchesTemplate leaves a token outside the vocabulary literal', () => {
  const vocab = new Set(['<PROJECT>'])
  assert.equal(matchesTemplate('a <OTHER> b', 'a x b', vocab).ok, false)
  assert.equal(matchesTemplate('a <OTHER> b', 'a x b', null).ok, true)
  assert.equal(matchesTemplate('price (1+1) <PROJECT>?', 'price (1+1) greet?', vocab).ok, true)
})

test('pollution: a kit plan file is caught, a templates twin and an empty file are not', () => {
  const kitPrivate = new Map([[hashOf('the kit roadmap\n'), 'plan/README.md'], [hashOf('shared\n'), 'plan/pending/README.md']])
  const templates = new Set([hashOf('shared\n')])
  const hits = pollution(files({ 'plan/README.md': 'the kit roadmap\r\n', 'plan/pending/README.md': 'shared\n', 'x/.gitkeep': '', 'README.md': 'mine\n' }), kitPrivate, templates)
  assert.deepEqual(hits, [{ rel: 'plan/README.md', from: 'plan/README.md' }])
})

test('upstreamHits: the slug in any case and the scope, binaries skipped', () => {
  const hits = upstreamHits(files({ 'a.md': 'see elder/kit and Elder/Kit', 'b.json': '{"name":"@elderscope/cli"}', 'c.md': 'acme/fork only', 'd.bin': 'Elder/Kit\0' }), KIT, SCOPE)
  assert.deepEqual(hits, [{ rel: 'a.md', n: 2 }, { rel: 'b.json', n: 1 }])
})

test('drift: lanes skipped, missing listed, drift reported with its line', () => {
  const kitFiles = { 'templates/skills/a.md': 'A <PROJECT>\n', 'templates/skills/b.md': 'B\n', 'templates/skills/m.lanes.md': 'L\n', 'templates/scripts/c.mjs': 'C\n' }
  const adopter = { 'skills/a.md': 'A greet\n', 'skills/b.md': 'B edited\n', 'skills/m.lanes.md': 'mine\n' }
  const pairs = [
    { kit: 'templates/skills/a.md', repo: 'skills/a.md', kind: 'skill' },
    { kit: 'templates/skills/b.md', repo: 'skills/b.md', kind: 'skill' },
    { kit: 'templates/skills/m.lanes.md', repo: 'skills/m.lanes.md', kind: 'lane' },
    { kit: 'templates/scripts/c.mjs', repo: 'scripts/c.mjs', kind: 'script' },
  ]
  const r = drift(pairs, (k) => kitFiles[k] ?? null, (p) => adopter[p] ?? null, new Set(['<PROJECT>']))
  assert.equal(r.same, 1)
  assert.deepEqual(r.missing, ['scripts/c.mjs'])
  assert.equal(r.drifted.length, 1)
  assert.equal(r.drifted[0].rel, 'skills/b.md')
  assert.equal(r.drifted[0].line, 1)
})

test('matchesTemplate takes the package-manager swap new-project.md sanctions, and nothing looser', () => {
  assert.equal(matchesTemplate('run `pnpm verify` first', 'run `npm run verify` first').ok, true)
  assert.equal(matchesTemplate('run `pnpm verify` first', 'run `yarn verify` first').ok, true)
  assert.equal(matchesTemplate('run `pnpm verify` first', 'run `make verify` first').ok, false)
  assert.equal(matchesTemplate('run `pnpm verify` first', 'run `npm run verify` later').ok, false)
})
