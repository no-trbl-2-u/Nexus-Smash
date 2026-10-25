#!/usr/bin/env node
// scripts/kit-id.mjs: the fork's identity, read from one file (spec 60).
//
// kit.json at the root names this repo, the upstream kit it was
// forked from, the npm package it publishes and where its docs live.
// Scripts and the CLI import readKit(root) instead of spelling any of
// them out. This is the fork's own identity, not a template: adopters
// never copy it.
//
//   node scripts/kit-id.mjs <field>          # repo, upstream, package or docs
//   node scripts/kit-id.mjs --json           # the whole object
//   node scripts/kit-id.mjs refs             # what still names upstream, per file
//   node scripts/kit-id.mjs refs --write     # lower scripts/kit-refs.json to that
//
// The verify gate's kit leg calls check(root): no tracked file outside
// the allow-list may name the upstream repo or the upstream npm scope,
// except the ones scripts/kit-refs.json lists, each at most at its
// listed count. The list only moves down: a count that rises is red,
// and so is one that fell while the list stayed (run refs --write).
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** The fields kit.json carries, in print order. */
export const FIELDS = Object.freeze(['repo', 'upstream', 'package', 'docs'])
/** The upstream npm scope; split so this file does not name it. */
export const SCOPE = '@' + 'usenexus/'
/** The ratchet's list of files that still name upstream. */
export const REFS_FILE = 'scripts/kit-refs.json'
const ABOUT = 'Files that still name the upstream kit, with their match counts (spec 60). Computed by node scripts/kit-id.mjs refs --write; the kit leg lets a count fall, never rise.'

/** kit.json at root, every field a string; throws naming the file. */
export function readKit(root = ROOT) {
  const file = path.join(root, 'kit.json')
  let raw
  try { raw = fs.readFileSync(file, 'utf-8') } catch { throw new Error(`kit.json: missing at ${root}`) }
  let kit
  try { kit = JSON.parse(raw) } catch (e) { throw new Error(`kit.json: not JSON (${e.message})`) }
  if (!kit || typeof kit !== 'object' || Array.isArray(kit)) throw new Error('kit.json: not an object')
  const missing = FIELDS.filter((f) => typeof kit[f] !== 'string' || !kit[f])
  if (missing.length) throw new Error(`kit.json: missing ${missing.join(', ')}`)
  return kit
}

/** Always allowed to name upstream: the identity itself, the licence, plan history, the identity layer, the list. */
export function isAllowed(rel) {
  return rel === 'kit.json' || rel === 'LICENSE' || rel === REFS_FILE || rel.startsWith('plan/') || rel.startsWith('identity/')
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** How many times text names the upstream repo slug (any case) or the upstream scope. */
export function countRefs(text, kit, scope = SCOPE) {
  const re = new RegExp(`${escape(kit.upstream)}|${escape(scope)}`, 'gi')
  return (text.match(re) || []).length
}

/** Tracked files, from git; node_modules never. */
export function trackedFiles(root = ROOT) {
  const out = execSync('git ls-files -z', { cwd: root, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 })
  return out.split('\0').filter(Boolean)
}

function readText(root, rel) {
  let buf
  try { buf = fs.readFileSync(path.join(root, rel)) } catch { return null }
  if (buf.subarray(0, 8000).includes(0)) return null
  return buf.toString('utf-8')
}

/** { path: count } for every file outside the allow-list that names upstream. */
export function scanRefs(root, { files, kit = readKit(root), scope = SCOPE } = {}) {
  const found = {}
  for (const rel of files ?? trackedFiles(root)) {
    if (isAllowed(rel) || rel.split('/').includes('node_modules')) continue
    const text = readText(root, rel)
    if (text === null) continue
    const n = countRefs(text, kit, scope)
    if (n) found[rel] = n
  }
  return found
}

function readRefs(root) {
  const file = path.join(root, REFS_FILE)
  if (!fs.existsSync(file)) return { listed: {}, problems: [`${REFS_FILE}: missing (node scripts/kit-id.mjs refs --write)`] }
  try {
    const files = JSON.parse(fs.readFileSync(file, 'utf-8')).files
    if (!files || typeof files !== 'object') throw new Error('no "files" object')
    return { listed: files, problems: [] }
  } catch (e) {
    return { listed: {}, problems: [`${REFS_FILE}: unreadable (${e.message})`] }
  }
}

/** The kit leg: { problems, files, refs } (files and references left). */
export function check(root = ROOT, opts = {}) {
  let actual
  try { actual = scanRefs(root, opts) } catch (e) { return { problems: [e.message], files: 0, refs: 0 } }
  const { listed, problems } = readRefs(root)
  for (const [rel, n] of Object.entries(actual).sort()) {
    if (!(rel in listed)) problems.push(`${rel}: names upstream ${n} time${n === 1 ? '' : 's'} and is not in ${REFS_FILE} (point it at kit.json, or the fork)`)
    else if (n > listed[rel]) problems.push(`${rel}: names upstream ${n} times, ${REFS_FILE} allows ${listed[rel]} (the list only moves down)`)
  }
  for (const [rel, allowed] of Object.entries(listed).sort()) {
    const n = actual[rel] ?? 0
    if (n < allowed) problems.push(`${rel}: names upstream ${n} time${n === 1 ? '' : 's'}, ${REFS_FILE} still lists ${allowed} (lower it: node scripts/kit-id.mjs refs --write)`)
  }
  const counts = Object.values(actual)
  return { problems, files: counts.length, refs: counts.reduce((a, b) => a + b, 0) }
}

/** Write REFS_FILE from what is on disk; returns the object written. */
export function writeRefs(root = ROOT, opts = {}) {
  const actual = scanRefs(root, opts)
  const files = Object.fromEntries(Object.keys(actual).sort().map((k) => [k, actual[k]]))
  const body = { about: ABOUT, files }
  fs.writeFileSync(path.join(root, REFS_FILE), `${JSON.stringify(body, null, 2)}\n`)
  return body
}

/** The CLI, with its root and streams injected; returns the exit code. */
export function run(argv, { root = ROOT, out = (s) => process.stdout.write(s), err = (s) => process.stderr.write(s) } = {}) {
  const [arg, flag] = argv
  try {
    if (arg === 'refs') {
      if (flag === '--write') {
        const body = writeRefs(root)
        const n = Object.values(body.files).reduce((a, b) => a + b, 0)
        out(`${REFS_FILE}: ${Object.keys(body.files).length} files, ${n} references left\n`)
        return 0
      }
      for (const [rel, n] of Object.entries(scanRefs(root)).sort()) out(`${n}\t${rel}\n`)
      return 0
    }
    const kit = readKit(root)
    if (arg === '--json') { out(`${JSON.stringify(kit, null, 2)}\n`); return 0 }
    if (!FIELDS.includes(arg)) {
      err(`kit-id: ${arg ? `unknown field "${arg}"` : 'name a field'}. Fields: ${FIELDS.join(', ')} (or --json, refs, refs --write)\n`)
      return 1
    }
    out(`${kit[arg]}\n`)
    return 0
  } catch (e) {
    err(`kit-id: ${e.message}\n`)
    return 1
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(run(process.argv.slice(2)))
}
