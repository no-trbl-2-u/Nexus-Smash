# 68 — The tree reverse-check derives from the trees

> The gate's reverse-check walks every directory the README
> trees expand, and the repo root's own files, instead of a
> hand-kept list that drifts the same way the trees do.

---

## Why

README.md's and templates/README.md's "What's in this kit"
trees drifting from disk is the kit's most repeated bug class:
nine confirmed fixes between 2026-07-19 and 2026-09-23. The
ninth was the gate itself: `scripts/verify.mjs`'s
`REVERSE_CHECK_DIRS` had silently missed four expanded
directories. The list is a second hand-kept copy of the trees'
shape, and root-level files (`CLAUDE.md`, `CONTRIBUTING.md`)
are never walked at all. Promoted from CANDIDATES (score 6.6,
proposed 2026-09-23) by `/oversight` on 2026-10-26.

## Design

- Replace `REVERSE_CHECK_DIRS` with a list derived from the
  parsed trees: every directory either tree expands is walked,
  minus a short explicit exclusion list (`plan/`, `.git/`,
  `node_modules/`, `.scratch/`).
- The repo root gets a non-recursive walk-and-compare for its
  direct files.
- No template API change; `verify.mjs` only.

## Acceptance

- **A1** Adding a file under any directory a tree expands, or
  at the repo root, without a tree entry fails the gate, and no
  hand-kept directory list remains in `verify.mjs`.

## Open questions

(None.)

## Chunks
Measure: 1 open · 0 closed · next A2

Not chunked yet.
