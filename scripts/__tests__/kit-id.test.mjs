// The fork's identity (spec 60): kit.json read by one script, and the
// kit leg's ratchet on text that still names the upstream kit.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { FIELDS, REFS_FILE, check, countRefs, isAllowed, readKit, run, writeRefs } from '../kit-id.mjs'

const KIT = { repo: 'acme/fork', upstream: 'Elder/Kit', package: '@acme/cli', docs: 'https://example.test/acme/fork/blob/main' }
const SCOPE = '@elderscope/'

function repo({ kit = KIT, files = {}, refs } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-kit-id-'))
  if (kit !== null) fs.writeFileSync(path.join(root, 'kit.json'), typeof kit === 'string' ? kit : JSON.stringify(kit))
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    fs.writeFileSync(path.join(root, rel), body)
  }
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true })
  if (refs) fs.writeFileSync(path.join(root, REFS_FILE), JSON.stringify({ about: 'x', files: refs }))
  return root
}

function cli(root, ...argv) {
  let out = ''
  let err = ''
  const code = run(argv, { root, out: (s) => { out += s }, err: (s) => { err += s } })
  return { code, out, err }
}

const tracked = (root) => Object.keys({ ...walk(root) })
function walk(root, dir = '', acc = {}) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${e.name}` : e.name
    if (e.isDirectory()) walk(root, rel, acc)
    else acc[rel] = true
  }
  return acc
}
const gate = (root) => check(root, { files: tracked(root), scope: SCOPE })

test('kit-id prints each field, and --json the object', () => {
  const root = repo()
  for (const f of FIELDS) {
    const r = cli(root, f)
    assert.equal(r.code, 0)
    assert.equal(r.out, `${KIT[f]}\n`)
  }
  const j = cli(root, '--json')
  assert.equal(j.code, 0)
  assert.deepEqual(JSON.parse(j.out), KIT)
  assert.deepEqual(readKit(root), KIT)
})

test('an unknown field exits 1 naming the valid ones', () => {
  const r = cli(repo(), 'owner')
  assert.equal(r.code, 1)
  for (const f of FIELDS) assert.match(r.err, new RegExp(f))
})

test('a missing or unparseable kit.json exits 1', () => {
  assert.equal(cli(repo({ kit: null }), 'repo').code, 1)
  assert.match(cli(repo({ kit: null }), 'repo').err, /kit\.json/)
  assert.equal(cli(repo({ kit: '{ not json' }), 'repo').code, 1)
  assert.equal(cli(repo({ kit: { repo: 'a/b' } }), 'repo').code, 1)
  assert.throws(() => readKit(repo({ kit: null })), /kit\.json/)
})

test('references count the upstream slug in any case and the upstream scope', () => {
  assert.equal(countRefs('see elder/kit and ELDER/KIT, npm i @elderscope/cli', KIT, SCOPE), 3)
  assert.equal(countRefs('acme/fork only', KIT, SCOPE), 0)
})

test('the allow-list: kit.json, LICENSE, plan/, identity/ and the refs list', () => {
  for (const f of ['kit.json', 'LICENSE', 'plan/60-x.md', 'identity/decisions.md', REFS_FILE]) assert.ok(isAllowed(f), f)
  for (const f of ['README.md', 'packages/cli/package.json', 'templates/plan/README.md']) assert.ok(!isAllowed(f), f)
})

test('green: every match is listed at its count; allowed files and binaries are not counted', () => {
  const root = repo({
    files: { 'README.md': 'clone Elder/Kit\n', 'plan/a.md': 'Elder/Kit Elder/Kit', LICENSE: 'Elder/Kit', 'a.bin': Buffer.from([0, 1, 2, ...Buffer.from('Elder/Kit')]) },
    refs: { 'README.md': 1 },
  })
  const res = gate(root)
  assert.deepEqual(res.problems, [])
  assert.equal(res.files, 1)
  assert.equal(res.refs, 1)
})

test('red: a file not in the list that names upstream', () => {
  const root = repo({ files: { 'README.md': 'Elder/Kit', 'docs.md': 'npm i @elderscope/cli' }, refs: { 'README.md': 1 } })
  const { problems } = gate(root)
  assert.equal(problems.length, 1)
  assert.match(problems[0], /docs\.md/)
  assert.match(problems[0], /1/)
})

test('red: a listed file whose count rose', () => {
  const root = repo({ files: { 'README.md': 'Elder/Kit Elder/Kit Elder/Kit' }, refs: { 'README.md': 2 } })
  const { problems } = gate(root)
  assert.equal(problems.length, 1)
  assert.match(problems[0], /README\.md.*2.*3|README\.md.*3.*2/)
})

test('red: a listed file whose count fell or reached 0 while the list stayed', () => {
  const root = repo({ files: { 'README.md': 'Elder/Kit', 'b.md': 'clean now' }, refs: { 'README.md': 2, 'b.md': 1, 'gone.md': 1 } })
  const { problems } = gate(root)
  assert.equal(problems.length, 3)
  for (const f of ['README.md', 'b.md', 'gone.md']) assert.ok(problems.some((p) => p.includes(f) && /--write/.test(p)), f)
})

test('refs --write lowers the list to what is on disk, and the gate goes green', () => {
  const root = repo({ files: { 'README.md': 'Elder/Kit', 'b.md': 'clean now' }, refs: { 'README.md': 2, 'b.md': 1 } })
  const written = writeRefs(root, { files: tracked(root), scope: SCOPE })
  assert.deepEqual(written.files, { 'README.md': 1 })
  assert.ok(written.about)
  assert.deepEqual(gate(root).problems, [])
})
