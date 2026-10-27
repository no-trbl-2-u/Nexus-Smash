// scripts/placeholders.mjs (the placeholders leg's scan): every <UPPER_SNAKE> token in the settled view of the tracked
// markdown is in the vocabulary. The settled view (scripts/plan/settled.mjs) is the plan as it reads once plan/pending/
// settles, so text a pending `## Add` or `## Edit` brings in is checked now, not after settle. The vocabulary lives in
// scripts/verify.mjs and is passed in. Pure: `read` and the view are injected.
import { settledView } from './plan/settled.mjs';

/** The token shape: one UPPER_SNAKE word, or several separated by single spaces. */
export const TOKEN_RE = /<[A-Z][A-Z0-9_]*(?: [A-Z][A-Z0-9_]*)*>/g;

/**
 * Scan `names` (repo-relative markdown paths); `read(rel)` gives each one's text. Returns { failures, seen }.
 */
export function scanPlaceholders(names, read, { vocabulary, retired, retiredHome }) {
  const failures = [];
  let seen = 0;
  for (const file of names) {
    const lines = read(file).split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const m of line.matchAll(TOKEN_RE)) {
        seen++;
        if (retired.has(m[0])) {
          if (file.split(String.fromCharCode(92)).join('/') !== retiredHome) {
            failures.push(`${file}:${i + 1}: ${m[0]} was renamed ${retired.get(m[0])} — only ${retiredHome} may name the old one`);
          }
        } else if (!vocabulary.has(m[0])) {
          failures.push(`${file}:${i + 1}: unknown placeholder ${m[0]} — typo, or add it to PLACEHOLDER_VOCABULARY in scripts/verify.mjs`);
        }
      }
    });
  }
  return { failures, seen };
}

/**
 * The tracked markdown read through the settled view of `root`, plus any markdown file a pending Add creates. A pending
 * file that won't settle is a failure of its own here only when it breaks the scan; the chunks leg names those.
 */
export function scanSettled(root, tracked, rules, view = settledView(root)) {
  const names = [...tracked];
  for (const q of view.changed) if (q.endsWith('.md') && !names.includes(q)) names.push(q);
  return scanPlaceholders(names, (rel) => view.read(rel) ?? '', rules);
}
