# 64 — The editable surface and `/refine`

> The files the loop may change about itself are named in one
> allow-list the gate enforces; under `Improve: bold` a night
> verb proposes edits to one skill from evidence, probes each
> candidate by replaying the verb, composes, selects blind on
> outcomes, and keeps the base unless the judge says
> otherwise.

## Why

The loop edits its own skills today in two ways: a briefed
chunk under a spec (nexus runs on itself), and the retro at
the end of a verb that "tightens the verb's own step". The
rule that the loop proposes but never edits its gates,
ceilings or hard rules is prose (`concepts/loop-shapes.md`
"meta-loop"; `agents.md` standing rules). Nothing mechanical
tells a briefed edit from an unbriefed one, and a retro edit
is adopted on one tick's evidence with no probe.

Spec 59 names the slot: `Improve: bold — nexus itself`,
0 of 5 chunks built. Spec 61 supplies the judge that an
unattended refiner needs.

A research harness (Apache 2.0, 2026-10) that edits an
agent's configuration files per task is the closest prior
art. What transferred in its ablations: an allow-listed
editable surface with mechanical validation, two proposal
lenses (how the agent works; what a practitioner knows),
re-running the agent with each candidate before composing,
a selector that sees only anonymized outcomes and never the
edit, and a reflection that may answer "no entry". What did
not: its judge never fed back into adoption, and its own
paper records a selector choosing a 55-point output over a
95-point one. We import the first list and refuse the second
by making spec 61's judge the acceptance test.

## Design

- **The surface.** `surface.json` at the root lists globs the
  loop may edit about itself without a briefed chunk:
  `skills/*.md` procedure sections, `skills/*.lanes.md`,
  `identity/footguns.md`, `plan/bearings.md` under
  `## Generators` and `## Plan expansion posture`. Forbidden
  always: `.claude/hooks/*`, `.claude/settings.json`,
  `.github/**`, `scripts/verify.mjs`, `scripts/pr/**`,
  bearings locked sections, `agents.md` standing rules.
  Character caps per file class. A `surface` leg in
  `scripts/verify.mjs` fails a commit whose subject starts
  `refine:` or `lessons:` and touches a path outside the
  list or over a cap; a briefed chunk's commit is unaffected.
- **`/refine <verb>`.** A night verb (`night.yml`, odd days,
  Sonnet; the composer step may use the owner's model
  choice), gated by `Improve: bold` through spec 59's
  resolver, never dispatched by `/march`.
  1. Evidence: the verb's last 3 closes from `ARCHIVE.md`
     and their PRs, the escape ledger rows that name the
     verb, open footguns tagged with it, and `walk.json`
     rows when the verb touches the GUI. Written to
     `.scratch/refine/<verb>/context/` as files; the
     proposer gets a 20-line mission, not an inline dump.
  2. Propose k=2 candidates per lens: `inv` (procedure:
     order, checks, stop conditions) and `dom` (domain:
     footguns, bearings knobs). Each edit cites one evidence
     file and line. `KEEP_BASE` is a valid answer.
  3. Probe: for each candidate, replay the verb on one of
     the 3 closes in a throwaway worktree with the candidate
     skill text and record the judge result, gate result,
     wall time and cost. A candidate that fails the gate is
     dropped.
  4. Compose one candidate from the survivors' diffs and
     probe it too.
  5. Select blind: a selector session sees only shuffled,
     anonymized probe outcomes (judge rows, gate, time,
     cost), never the diffs, and names one or `KEEP_BASE`.
  6. Adopt only if the chosen outcome is at least the base
     on every judge row and the gate; else `KEEP_BASE`.
  7. Reflect: one footgun line or one `D?<slug>` decision via
     a pending file, with a verdict per edit from
     `helped | hurt | no effect | confounded`, or `NO_ENTRY`.
     Land as a `refine: <verb>` PR through spec 61's judge;
     the owner merges.
- **Audit.** Every proposer, selector and reflector call is
  stored content-addressed under `.nexus/audit/<sha>/`
  (mission, response, workspace diff); a repeated call with
  the same inputs is served from the cache.
- **Budget.** At most one `/refine` per night, one verb per
  run, 2+2+1 probes; `night.yml`'s existing ceiling applies.
  A run that would exceed the quota governor's cap skips with
  a one-line no-op reason.
- **Templates.** `surface.json`, the gate leg and
  `templates/skills/refine.md` ship behind `Improve: bold`;
  an adopter at `steady` or below has the surface leg only.

## Contracts

- `surface.json`: `{ "allow": [glob...], "deny": [glob...],
  "caps": { "<class>": <chars> } }`.
- Commit subjects `refine: <verb>` and `lessons: <slug>` are
  surface-bound.
- `node scripts/refine.mjs <verb> [--k 2] [--dry]`; output
  dir `.scratch/refine/<verb>/`.
- `.nexus/audit/<sha>/{mission.md,response.md,diff.patch}`.

## Acceptance

- **A1** `surface.json` exists; the `surface` leg fails a `refine:` or `lessons:` commit touching a denied path or exceeding a cap 100% of the time in its test, and passes a briefed chunk's commit to the same path.
- **A2** `/refine <verb>` under `Improve: bold` writes the evidence context as files, proposes 2 `inv` and 2 `dom` candidates each citing evidence, and treats `KEEP_BASE` as valid; under any lower dial it exits with a one-line reason.
- **A3** Each candidate is probed by replaying the verb in a throwaway worktree; gate-red candidates are dropped; the selector receives only anonymized outcomes and never a diff.
- **A4** Adoption requires the chosen outcome to be at least the base on every judge row and the gate; across 10 runs on the kit's own verbs at least 5 return `KEEP_BASE`; no adopted edit lowers the escape ledger over the next 10 merged PRs.
- **A5** Every model call is content-addressed under `.nexus/audit/` and a repeated call is served from the cache; the reflection lands one footgun or decision, or `NO_ENTRY`, through a pending file.
- **A6** `night.yml` runs `/refine` on odd days only within its ceiling and skips under the quota cap; template twins exist behind `Improve: bold`.

## Open questions

(None.)

## Chunks
Measure: 6 open · 0 closed · next A7

- [ ] **64.1** `surface.json` and the `surface` gate leg · S · closes A1 · needs —
- [ ] **64.2** Evidence context and the two proposal lenses · M · closes A2 · needs 64.1, 59.1
- [ ] **64.3** Probe in a throwaway worktree; blind selection · L · closes A3 · needs 64.2, 61.2
- [ ] **64.4** Adopt only on the judge; ten runs measured · M · closes A4 · needs 64.3, 61.3
- [ ] **64.5** Content-addressed audit and the reflection · M · closes A5 · needs 64.3
- [ ] **64.6** `night.yml` schedule, quota skip, templates · S · closes A6 · needs 64.4, 64.5
  - Workflow file: ships from a local session (cloud token).
