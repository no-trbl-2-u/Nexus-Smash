# 67 — Support routing reads the author association

> `support.mjs route` reads who filed an issue through a field
> `gh` accepts, so spec 54's Support routing runs instead of
> falling back to plain triage every time.

---

## Why

`scripts/plan/support.mjs` `ghIssue()` asks `gh issue view
--json number,authorAssociation,labels`. The installed `gh`
rejects `authorAssociation` as an unknown field, so the call
fails, `ghIssue()` returns null, and `support.mjs route`
always prints `gh unavailable: triage routes as today`. Spec
54's Support routing is silently off. The template twin
`templates/scripts/plan/support.mjs` is byte-identical, so
every adopter has the same gap. Found in heads-down 60.3
(2026-10-25, AUDIT `[C, 6.3]`); moved to the Asap lane by
`/oversight` on 2026-10-26, since AUDIT rows wait behind every
ready chunk.

## Design

- `ghIssue()` reads `gh api repos/{owner}/{repo}/issues/<n>`
  and takes `author_association` and `labels[].name` from the
  REST reply. The `run` seam stays, so tests stub the reply.
- Both copies change together (the scripts leg keeps them
  byte-identical).
- A test stubs `gh` with a REST-shaped reply and asserts the
  association and labels come back; a second stubs a failing
  `gh` and asserts null.

## Acceptance

- **A1** `support.mjs route` on a real issue in this repo
  prints a routing decision, not `gh unavailable`, and a test
  that stubs the REST reply covers both the success and the
  failure path.

## Open questions

(None.)

## Chunks
Measure: 1 open · 0 closed · next A2

- [ ] **67.1** `ghIssue()` reads the REST author association · S · closes A1 · needs —
