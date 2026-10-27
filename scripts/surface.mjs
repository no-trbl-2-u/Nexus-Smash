// scripts/surface.mjs: the editable surface (spec 64, A1).
//
// surface.json at the root names what the loop may edit about itself
// without a briefed chunk: { allow: [glob...], deny: [glob...],
// caps: { <glob>: <chars> } }. The verify gate's surface leg calls
// checkRange(): a commit whose subject starts `refine` or `lessons`
// (any case, any punctuation after: `Refine:`, `refine!:`, `refine :`
// are all bound) is surface-bound and fails when it touches a path
// outside the allow-list (or inside the deny-list), changes a bearings
// section the list does not name, adds or removes a heading there,
// changes a binary file, or pushes a file over its cap. Any other
// subject (a briefed chunk's feat:, docs:, ...) is not inspected.
// verify.mjs runs main on import, so the logic lives here.
//
// Conventions: `*` stays inside one path segment, `**` crosses them;
// an allow entry `path#Heading` allows only the body of that `## `
// section of the file, with every other section and the heading list
// unchanged; deny beats allow; a cap key is a glob and the first key
// (in file order) matching the path applies. A cap counts the
// characters ADDED to a file, summed over every bound commit in the
// range, so two commits cannot split one budget.
//
// The range is merge-base(base, HEAD)..HEAD, merges included (a merge
// is diffed against its first parent). base is origin/$GITHUB_BASE_REF
// when set, else origin/main. A base that does not resolve, or a
// shallow clone, fails closed.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export const BOUND = /^\s*(refine|lessons)\b/i
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

export function globToRegExp(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++ } else re += '[^/]*'
    } else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}
const matches = (glob, p) => globToRegExp(glob).test(p)

export function loadSurface(root) {
  const file = path.join(root, 'surface.json')
  if (!fs.existsSync(file)) return { surface: null, problems: ['surface.json: missing'] }
  let s
  try { s = JSON.parse(fs.readFileSync(file, 'utf-8')) } catch (e) { return { surface: null, problems: [`surface.json: unparseable (${e.message})`] } }
  const problems = []
  for (const k of ['allow', 'deny']) if (!Array.isArray(s[k]) || s[k].some((g) => typeof g !== 'string')) problems.push(`surface.json: "${k}" must be an array of globs`)
  if (!s.caps || typeof s.caps !== 'object' || Object.values(s.caps).some((n) => !Number.isInteger(n) || n < 0)) problems.push('surface.json: "caps" must map a glob to a character count')
  return { surface: problems.length ? null : s, problems }
}

/** Characters added by a single-file -U0 patch (header lines before the first hunk are not content). */
export function addedChars(patch) {
  let inHunk = false
  let n = 0
  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) { inHunk = true; continue }
    if (line.startsWith('diff --git')) { inHunk = false; continue }
    if (inHunk && line.startsWith('+')) n += line.length // the '+' stands for the newline
  }
  return n
}

/** Split markdown into its `## ` headings, in order, and each section's body (key '' = above the first heading). */
export function sections(text) {
  const heads = []
  const bodies = new Map([['', []]])
  let cur = ''
  for (const line of String(text ?? '').replace(/\r\n/g, '\n').split('\n')) {
    const m = /^##\s+(.*?)\s*$/.exec(line)
    if (m) { cur = m[1]; heads.push(cur); if (!bodies.has(cur)) bodies.set(cur, []); else bodies.get(cur).push(line); continue }
    bodies.get(cur).push(line)
  }
  return { heads, bodies: new Map([...bodies].map(([k, v]) => [k, v.join('\n')])) }
}

/** Why a change to a `#Heading`-scoped file leaves its allowed sections, or [] when it stays inside. */
export function sectionProblems(oldText, newText, allowedHeads) {
  const a = sections(oldText)
  const b = sections(newText)
  const out = []
  if (a.heads.join('\n') !== b.heads.join('\n')) out.push('adds, removes or renames a "## " heading')
  const names = new Set([...a.bodies.keys(), ...b.bodies.keys()])
  for (const k of names) {
    if (allowedHeads.includes(k)) continue
    if (a.bodies.get(k) !== b.bodies.get(k)) out.push(k === '' ? 'changes text above the first heading' : `changes section "${k}"`)
  }
  return out
}

/**
 * Problems with one commit against the surface; [] when clean or not surface-bound.
 * commit = { subject, files: [{ path, added, binary }], readOld(path), readNew(path) }.
 * `totals` carries characters already added per path by earlier bound commits in the range
 * (mutated); a cap breach is reported by the commit that crosses it.
 */
export function checkCommit({ subject, files, readOld = () => null, readNew = () => null }, surface, totals = {}) {
  if (!BOUND.test(subject)) return []
  const problems = []
  for (const f of files) {
    const where = f.path
    const denied = surface.deny.find((g) => matches(g, f.path))
    if (denied) { problems.push(`${where}: denied by "${denied}"`); continue }
    const whole = surface.allow.some((g) => !g.includes('#') && matches(g, f.path))
    if (!whole) {
      const heads = surface.allow.filter((g) => g.includes('#') && matches(g.slice(0, g.indexOf('#')), f.path)).map((g) => g.slice(g.indexOf('#') + 1))
      if (heads.length === 0) { problems.push(`${where}: outside the allow-list`); continue }
      const sp = f.binary ? ['is binary'] : sectionProblems(readOld(f.path), readNew(f.path), heads)
      if (sp.length) { problems.push(`${where}: ${sp.join('; ')}; only ${heads.map((h) => `"${h}"`).join(', ')} may change`); continue }
    }
    const capKey = Object.keys(surface.caps).find((g) => matches(g, f.path))
    if (f.binary) { if (capKey !== undefined) problems.push(`${where}: binary change on a capped path`); continue }
    if (capKey !== undefined) {
      const before = totals[f.path] ?? 0
      totals[f.path] = before + f.added
      if (before <= surface.caps[capKey] && totals[f.path] > surface.caps[capKey]) problems.push(`${where}: adds ${totals[f.path]} characters across the range, over the ${surface.caps[capKey]} cap of "${capKey}"`)
    }
  }
  return problems
}

const git = (root, args) => execFileSync('git', ['-c', 'core.quotepath=off', ...args], { cwd: root, encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
const tryGit = (root, args) => { try { return git(root, args).trim() } catch { return null } }

/** The commits to inspect, oldest first; { error } when the base cannot be trusted (fail closed). */
export function commitsToCheck(root, env = process.env) {
  if (tryGit(root, ['rev-parse', '--is-shallow-repository']) === 'true') return { error: 'surface: shallow clone; the range cannot be walked (fetch full depth: git fetch --unshallow, or actions/checkout fetch-depth: 0)' }
  const ref = env.GITHUB_BASE_REF ? `origin/${env.GITHUB_BASE_REF}` : 'origin/main'
  if (tryGit(root, ['rev-parse', '--verify', '-q', ref]) === null) return { error: `surface: base ${ref} does not resolve; fetch it so the range can be walked` }
  const base = tryGit(root, ['merge-base', ref, 'HEAD'])
  if (!base) return { error: `surface: no merge-base between ${ref} and HEAD` }
  const list = git(root, ['rev-list', '--reverse', `${base}..HEAD`]).split('\n').filter(Boolean)
  if (list.length) return { shas: list }
  const head = tryGit(root, ['rev-parse', 'HEAD'])
  return { shas: head ? [head] : [] }
}

/** Per-file facts for one commit against its first parent (empty tree for a root). */
function commitFiles(root, sha) {
  const parent = tryGit(root, ['rev-parse', '--verify', '-q', `${sha}^1`]) ?? EMPTY_TREE
  const problems = []
  const files = []
  const raw = git(root, ['diff', '--numstat', '-z', '--no-renames', parent, sha])
  for (const entry of raw.split('\0').filter((e) => e !== '')) {
    const m = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(entry)
    if (!m) { problems.push(`unparsed diff entry ${JSON.stringify(entry)}`); continue }
    const binary = m[1] === '-'
    const p = m[3]
    const patch = binary ? '' : git(root, ['diff', '-U0', '--no-renames', parent, sha, '--', `:(literal)${p}`])
    files.push({ path: p, binary, added: addedChars(patch) })
  }
  return { parent, files, problems }
}

/** Run the surface check over the range `commitsToCheck` names. */
export function checkRange(root, surface, opts = {}) {
  const r = opts.shas ? { shas: opts.shas } : commitsToCheck(root, opts.env)
  if (r.error) return { failures: [r.error], checked: 0, bound: 0 }
  const failures = []
  const totals = {}
  let bound = 0
  for (const sha of r.shas) {
    const subject = git(root, ['log', '-1', '--format=%s', sha]).trim()
    if (!BOUND.test(subject)) continue
    bound++
    const { parent, files, problems } = commitFiles(root, sha)
    const readNew = (p) => tryGitRaw(root, `${sha}:${p}`)
    const readOld = (p) => tryGitRaw(root, `${parent}:${p}`)
    for (const p of [...problems, ...checkCommit({ subject, files, readOld, readNew }, surface, totals)]) failures.push(`${sha.slice(0, 7)} "${subject}": ${p}`)
  }
  return { failures, checked: r.shas.length, bound }
}

function tryGitRaw(root, spec) { try { return git(root, ['show', spec]) } catch { return null } }
