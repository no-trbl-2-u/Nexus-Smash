// scripts/surface.mjs: the editable surface (spec 64, A1).
//
// surface.json at the root names what the loop may edit about itself
// without a briefed chunk: { allow: [glob...], deny: [glob...],
// caps: { <glob>: <chars> } }. The verify gate's surface leg calls
// checkRange(): a commit whose subject starts `refine:` or `lessons:`
// is surface-bound and fails when it touches a path outside the
// allow-list (or inside the deny-list), edits a bearings section the
// list does not name, or adds more characters to a file than its cap.
// Any other subject (a briefed chunk's feat:, docs:, ...) is not
// inspected. verify.mjs runs main on import, so the logic lives here.
//
// Conventions: `*` stays inside one path segment, `**` crosses them;
// an allow entry `path#Heading` allows only the lines under that
// `## Heading` of the file; deny beats allow; a cap key is a glob and
// the first key (in file order) matching the path applies; the cap
// counts characters ADDED to that file by the commit.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export const BOUND = /^(refine|lessons)(\([^)]*\))?:/

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

/** Split a unified diff (-U0) into { path, added, hunks: [{ start, count }] } per file. */
export function parsePatch(patch) {
  const files = []
  let cur = null
  for (const line of patch.split('\n')) {
    const h = /^diff --git a\/(.+) b\/(.+)$/.exec(line)
    if (h) { cur = { path: h[2], added: 0, hunks: [], deleted: false }; files.push(cur); continue }
    if (!cur) continue
    if (line.startsWith('+++ ')) { if (line === '+++ /dev/null') cur.deleted = true; continue }
    if (line.startsWith('--- ')) continue
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (m) { cur.hunks.push({ start: Number(m[1]), count: m[2] === undefined ? 1 : Number(m[2]) }); continue }
    if (line.startsWith('+')) cur.added += line.length // the '+' stands for the newline
  }
  return files
}

/** The `## ` sections the changed lines of a file fall in (null = before the first heading). */
function sectionsTouched(hunks, newText) {
  const lines = newText.replace(/\r\n/g, '\n').split('\n')
  const at = (n) => {
    for (let i = Math.min(n, lines.length) - 1; i >= 0; i--) {
      const m = /^##\s+(.*?)\s*$/.exec(lines[i])
      if (m) return m[1]
    }
    return null
  }
  const out = new Set()
  for (const { start, count } of hunks) {
    const last = count === 0 ? start : start + count - 1
    for (let n = Math.max(start, 1); n <= Math.max(last, 1); n++) out.add(at(n))
  }
  return out
}

/**
 * Problems with one commit against the surface; [] when clean or not surface-bound.
 * `readNew(path)` returns the file's text after the commit (needed for `#Heading` entries).
 */
export function checkCommit({ subject, patch, readNew }, surface) {
  if (!BOUND.test(subject)) return []
  const problems = []
  for (const f of parsePatch(patch)) {
    const where = `${f.path}`
    const denied = surface.deny.find((g) => matches(g, f.path))
    if (denied) { problems.push(`${where}: denied by "${denied}"`); continue }
    const whole = surface.allow.some((g) => !g.includes('#') && matches(g, f.path))
    if (!whole) {
      const heads = surface.allow.filter((g) => g.includes('#') && matches(g.slice(0, g.indexOf('#')), f.path)).map((g) => g.slice(g.indexOf('#') + 1))
      if (heads.length === 0) { problems.push(`${where}: outside the allow-list`); continue }
      if (f.deleted) { problems.push(`${where}: deleted, but only sections ${heads.map((h) => `"${h}"`).join(', ')} are editable`); continue }
      const touched = sectionsTouched(f.hunks, readNew(f.path) ?? '')
      const bad = [...touched].filter((s) => s === null || !heads.includes(s))
      if (bad.length) { problems.push(`${where}: touches ${bad.map((s) => (s === null ? 'text above the first heading' : `section "${s}"`)).join(', ')}; only ${heads.map((h) => `"${h}"`).join(', ')} may change`); continue }
    }
    const capKey = Object.keys(surface.caps).find((g) => matches(g, f.path))
    if (capKey !== undefined && f.added > surface.caps[capKey]) problems.push(`${where}: adds ${f.added} characters, over the ${surface.caps[capKey]} cap of "${capKey}"`)
  }
  return problems
}

const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })

/**
 * The commits to inspect: origin/main..HEAD when that names any, else HEAD alone
 * (an owner-mode commit made on main, before its push).
 */
export function commitsToCheck(root) {
  let range = []
  try {
    git(root, ['rev-parse', '--verify', '-q', 'origin/main'])
    range = git(root, ['rev-list', '--no-merges', 'origin/main..HEAD']).split('\n').filter(Boolean)
  } catch { /* no origin/main: HEAD alone */ }
  if (range.length) return range
  try { return git(root, ['rev-list', '--no-merges', '-n', '1', 'HEAD']).split('\n').filter(Boolean) } catch { return [] }
}

/** Run the surface check over the commits `commitsToCheck` names. */
export function checkRange(root, surface, shas = commitsToCheck(root)) {
  const failures = []
  let bound = 0
  for (const sha of shas) {
    const subject = git(root, ['log', '-1', '--format=%s', sha]).trim()
    if (!BOUND.test(subject)) continue
    bound++
    const patch = git(root, ['show', '--format=', '--no-renames', '-U0', '--root', sha])
    const readNew = (p) => { try { return git(root, ['show', `${sha}:${p}`]) } catch { return null } }
    for (const p of checkCommit({ subject, patch, readNew }, surface)) failures.push(`${sha.slice(0, 7)} "${subject}": ${p}`)
  }
  return { failures, checked: shas.length, bound }
}
