# 66 — Context as files, mission as a pointer

> A builder, reader or refiner sub-agent gets a directory of
> evidence and a twenty-line mission that tells it to go
> read, never a prompt that inlines and truncates the
> evidence.

## Why

`/next` hands its builder the chunk's brief inline
(`skills/next/build.md`), and spec 61's review readers would
receive up to 120k characters of diff the same way. Inline
evidence is truncated to fit, cannot be grepped, and is paid
for in full on every call even when the sub-agent needs one
file of it.

A research harness (Apache 2.0, 2026-10) that runs agentic
editor sessions over large trajectories writes the evidence
as a directory (`task.md`, `rollouts/`, `deliverables/`,
`harness/`, `pool/<candidate>/harness.diff`, `decisions/`)
and gives the session a short mission pointing at it. Nothing
is truncated; the session reads what it needs. Spec 64
already adopts the shape for `/refine`; this spec makes it
the kit's default for every delegated read.

## Design

- **`scripts/context.mjs`.** `build <kind> <id>` writes
  `.scratch/context/<kind>-<id>/`: `mission.md` (at most 20
  lines: the goal, the rules, and the file list), `spec.md`
  (the spec's relevant sections), `acceptance.md`, `board.md`
  (spec 62 snapshot), `footguns.md` (open lines), and for
  review `assignment.md`, `diff.patch`, `consumers/`. Kinds:
  `build`, `review`, `refine`.
- **Skills point, not paste.** `skills/next/build.md` and
  `skills/review.md` pass the directory path and
  `mission.md` to the sub-agent and nothing else. The
  sub-agent's first step is to read `mission.md`.
- **Caps become file lists.** The 120k-character reader cap
  becomes a file count and a per-file size in `assignment.md`;
  a reader greps rather than reading everything.
- **Hygiene.** `.scratch/context/` is gitignored; `tidy`
  prunes it; nothing under it is read by plan-check or the
  gate.
- **Templates.** `context.mjs` and the two skill changes ship
  as twins.

## Contracts

- `node scripts/context.mjs build build|review|refine <id>
  [--out <dir>]` prints the directory.
- `mission.md` is at most 20 lines and names every file in
  the directory.

## Acceptance

- **A1** `context.mjs build` writes the directory for each kind with a `mission.md` of at most 20 lines naming every file; its test covers the three kinds.
- **A2** `/next`'s builder and spec 61's readers receive only the directory path and the mission; the sub-agent prompts in both skills contain no inlined spec or diff text.
- **A3** Over 10 reviewed PRs, reader token spend per PR is lower than the inline baseline recorded before the change, and the planted-defect recall from spec 61 A4 does not fall.
- **A4** Template twins exist and the `upgrade` leg lists `context.mjs`.

## Open questions

(None.)

## Chunks
Measure: 4 open · 0 closed · next A5

- [ ] **66.1** `context.mjs` and the three kinds · M · closes A1 · needs 62.2
- [ ] **66.2** Builder and readers take the pointer · M · closes A2 · needs 66.1, 61.4
- [ ] **66.3** Ten PRs measured against the inline baseline · S · closes A3 · needs 66.2
- [ ] **66.4** Template twins · S · closes A4 · needs 66.3
