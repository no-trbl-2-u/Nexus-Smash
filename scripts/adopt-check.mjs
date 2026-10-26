#!/usr/bin/env node
// scripts/adopt-check.mjs: did a repo adopt this kit cleanly? (spec 60, A5)
//
// Reads an adopter checkout against a kit checkout (this repo by
// default, at the commit it was adopted from) and fails when:
//
//   (i)   a file in the adopter came from the kit's own plan/ or
//         identity/ (same content hash), unless a file under
//         templates/ carries the same bytes;
//   (ii)  a skill, command or script the kit ships (the set
//         scripts/upgrade-files.mjs computes; lanes files are the
//         adopter's own) differs from its templates/ copy beyond
//         placeholder substitution (the vocabulary is read from the
//         kit's scripts/verify.mjs, plus the package-manager swap
//         playbooks/new-project.md sanctions: `pnpm` sed-replaced by
//         npm run, yarn or bun), or the core of the loop is missing;
//   (iii) any adopter text names the upstream repo slug or the
//         upstream npm scope (the patterns scripts/kit-id.mjs uses).
//
//   node scripts/adopt-check.mjs <adopter-dir> [--kit <kit-dir>] [--json]
//
// Exit 0 clean, 1 a problem, 2 a usage error. Read-only on both trees.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { SCOPE, countRefs, readKit } from './kit-id.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Folders never read in either tree. */
export const SKIP_DIRS = Object.freeze(new Set(['.git', 'node_modules', '.nexus']))
/** The kit's own state: what an adopter must never carry. */
export const PRIVATE_DIRS = Object.freeze(['plan', 'identity'])
/** The loop's core: an adoption without these did not happen. */
export const CORE = Object.freeze(['skills/march.md', 'skills/next.md', '.claude/commands/march.md', 'scripts/plan-check.mjs'])
/** The token shape the placeholders leg matches (scripts/verify.mjs). */
export const TOKEN = /<[A-Z][A-Z0-9_]*(?: [A-Z][A-Z0-9_]*)*>/g
/** The package-manager swap playbooks/new-project.md "Prerequisites" sanctions: the word pnpm, as another manager. */
export const PM_WORD = /\bpnpm\b/
const PM_ALT = '(?:pnpm|npm run|npm|yarn|bun run|bun)'

const lf = (s) => s.replace(/\r\n/g, '\n')
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Hash of a file's content with line endings made LF (a checkout's autocrlf must not hide a copy). */
export function hashOf(buf) {
  const text = Buffer.isBuffer(buf) ? buf.toString('utf-8') : String(buf)
  return createHash('sha256').update(lf(text)).digest('hex')
}

/** True when a buffer carries content worth matching: not empty, not whitespace only. */
export function substantive(buf) {
  return buf.toString('utf-8').trim().length > 0
}

/** The placeholder vocabulary from verify.mjs's text: the tokens inside `PLACEHOLDER_VOCABULARY = new Set([...])`. */
export function vocabularyFrom(verifyText) {
  const m = /PLACEHOLDER_VOCABULARY\s*=\s*new Set\(\[([\s\S]*?)\]\)/.exec(verifyText || '')
  if (!m) return null
  const body = m[1].replace(/^\s*\/\/.*$/gm, '')
  return new Set([...body.matchAll(/'(<[^']+>)'/g)].map((x) => x[1]))
}

/**
 * Does `actual` equal `template` once each placeholder in the template is replaced by some value? Line by
 * line: same line count, a line with no placeholder is equal, a line with one matches with each placeholder
 * as a run of non-newline text and the word pnpm as any package manager (PM_WORD). Returns
 * { ok, line?, expected?, got? } (line is 1-based).
 */
export function matchesTemplate(template, actual, vocab = null) {
  const t = lf(template).split('\n')
  const a = lf(actual).split('\n')
  if (t.length !== a.length) return { ok: false, line: Math.min(t.length, a.length), expected: `${t.length} lines`, got: `${a.length} lines` }
  for (let i = 0; i < t.length; i++) {
    if (t[i] === a[i]) continue
    const tokens = (t[i].match(TOKEN) || []).filter((tok) => !vocab || vocab.has(tok))
    if (tokens.length || PM_WORD.test(t[i])) {
      const alts = [...tokens.map(escape), PM_WORD.source]
      const parts = t[i].split(new RegExp(`(${alts.join('|')})`))
      const body = parts.map((p, j) => (j % 2 ? (p === 'pnpm' ? PM_ALT : '.*?') : escape(p))).join('')
      if (new RegExp('^' + body + '$').test(a[i])) continue
    }
    return { ok: false, line: i + 1, expected: t[i], got: a[i] }
  }
  return { ok: true }
}

/** Every file under root (posix, relative), SKIP_DIRS left out; symlinks never followed. */
export function walk(root, dir = '') {
  const out = []
  let entries
  try { entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (e.isSymbolicLink() || SKIP_DIRS.has(e.name)) continue
    const rel = dir ? `${dir}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...walk(root, rel))
    else if (e.isFile()) out.push(rel)
  }
  return out
}

/**
 * (i) The adopter files whose content is a kit plan/ or identity/ file's. `kitPrivate` maps hash -> kit path,
 * `templateHashes` the hashes of every file under templates/ (a byte twin there is the product, not a leak).
 */
export function pollution(adopterFiles, kitPrivate, templateHashes) {
  const hits = []
  for (const [rel, buf] of adopterFiles) {
    if (!substantive(buf)) continue
    const h = hashOf(buf)
    if (kitPrivate.has(h) && !templateHashes.has(h)) hits.push({ rel, from: kitPrivate.get(h) })
  }
  return hits
}

/** (iii) The adopter files that name upstream, with counts. Binary files are skipped. */
export function upstreamHits(adopterFiles, kit, scope = SCOPE) {
  const hits = []
  for (const [rel, buf] of adopterFiles) {
    if (buf.subarray(0, 8000).includes(0)) continue
    const n = countRefs(buf.toString('utf-8'), kit, scope)
    if (n) hits.push({ rel, n })
  }
  return hits
}

/** (ii) The shipped files the adopter carries that drift from templates/. `pairs` is [{ kit, repo, kind }]. */
export function drift(pairs, readKitFile, readAdopterFile, vocab) {
  const drifted = []
  const missing = []
  let same = 0
  for (const p of pairs) {
    if (p.kind === 'lane') continue
    const got = readAdopterFile(p.repo)
    if (got === null) { missing.push(p.repo); continue }
    const want = readKitFile(p.kit)
    if (want === null) continue
    const r = matchesTemplate(want, got, vocab)
    if (r.ok) same++
    else drifted.push({ rel: p.repo, ...r })
  }
  return { drifted, missing, same }
}

function readOrNull(abs) {
  try { return fs.readFileSync(abs, 'utf-8') } catch { return null }
}

function headOf(dir) {
  try { return execFileSync('git', ['-C', dir, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return null }
}

/** The whole check over two trees: { problems, notes }. */
export async function check(adopter, kitDir = ROOT) {
  const problems = []
  const notes = []
  const kit = readKit(kitDir)
  const head = headOf(kitDir)
  notes.push(`kit ${kit.repo} at ${kitDir}${head ? ` (${head})` : ''}`)

  const files = new Map(walk(adopter).map((rel) => [rel, fs.readFileSync(path.join(adopter, rel))]))
  notes.push(`${files.size} adopter files read`)

  const kitPrivate = new Map()
  for (const d of PRIVATE_DIRS) {
    for (const rel of walk(kitDir, d)) {
      const buf = fs.readFileSync(path.join(kitDir, rel))
      if (substantive(buf)) kitPrivate.set(hashOf(buf), rel)
    }
  }
  const templateHashes = new Set(walk(kitDir, 'templates').map((rel) => hashOf(fs.readFileSync(path.join(kitDir, rel)))))
  const leaks = pollution(files, kitPrivate, templateHashes)
  for (const l of leaks) problems.push(`${l.rel}: the kit's own ${l.from} (no templates/ twin): plan/ and identity/ are this kit's state, never an adopter's`)
  notes.push(`(i) ${kitPrivate.size} kit plan/identity files hashed: ${leaks.length} carried`)

  const { upgradeFiles } = await import(pathToFileURL(path.join(kitDir, 'scripts', 'upgrade-files.mjs')).href)
  const vocab = vocabularyFrom(readOrNull(path.join(kitDir, 'scripts', 'verify.mjs')))
  if (!vocab) notes.push('(ii) no PLACEHOLDER_VOCABULARY in the kit\'s verify.mjs: every <TOKEN> counts as a placeholder')
  const pairs = upgradeFiles(kitDir).files
  const d = drift(pairs, (k) => readOrNull(path.join(kitDir, k)), (r) => (files.has(r) ? files.get(r).toString('utf-8') : null), vocab)
  for (const x of d.drifted) problems.push(`${x.rel}:${x.line}: differs from templates/ beyond placeholders (want ${JSON.stringify(x.expected)}, got ${JSON.stringify(x.got)})`)
  for (const c of CORE) if (!files.has(c)) problems.push(`${c}: missing (the loop's core; was the kit adopted?)`)
  notes.push(`(ii) ${pairs.length} shipped files: ${d.same} match, ${d.drifted.length} drift, ${d.missing.length} not carried${d.missing.length ? ` (${d.missing.slice(0, 6).join(', ')}${d.missing.length > 6 ? ', ...' : ''})` : ''}`)

  const up = upstreamHits(files, kit)
  for (const u of up) problems.push(`${u.rel}: names the upstream kit (${kit.upstream} or ${SCOPE}) ${u.n} time${u.n === 1 ? '' : 's'}`)
  notes.push(`(iii) upstream ${kit.upstream} / ${SCOPE}: ${up.length} files`)
  return { problems, notes }
}

/** The CLI; returns the exit code. */
export async function run(argv, { out = (s) => process.stdout.write(s), err = (s) => process.stderr.write(s) } = {}) {
  let adopter
  let kitDir = ROOT
  let json = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--kit') { kitDir = argv[++i]; if (!kitDir) { err('adopt-check: --kit needs a folder\n'); return 2 } }
    else if (a === '--json') json = true
    else if (a.startsWith('--')) { err(`adopt-check: unknown option ${a}\n`); return 2 }
    else if (!adopter) adopter = a
    else { err('adopt-check: one adopter folder\n'); return 2 }
  }
  if (!adopter) { err('usage: node scripts/adopt-check.mjs <adopter-dir> [--kit <kit-dir>] [--json]\n'); return 2 }
  adopter = path.resolve(adopter)
  kitDir = path.resolve(kitDir)
  if (!fs.existsSync(adopter) || !fs.statSync(adopter).isDirectory()) { err(`adopt-check: ${adopter} is not a folder\n`); return 2 }
  let r
  try { r = await check(adopter, kitDir) } catch (e) { err(`adopt-check: ${e.message}\n`); return 2 }
  if (json) out(`${JSON.stringify(r, null, 2)}\n`)
  else {
    for (const n of r.notes) out(`  ${n}\n`)
    for (const p of r.problems) out(`  FAIL ${p}\n`)
    out(r.problems.length ? `adopt-check: ${r.problems.length} problem${r.problems.length === 1 ? '' : 's'} in ${adopter}\n` : `adopt-check: ${adopter} adopted cleanly\n`)
  }
  return r.problems.length ? 1 : 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await run(process.argv.slice(2)))
}
