# 72 — The evolving-team supervisor

> When a spec stalls, `/evolve` names the cause from a fixed
> taxonomy, writes the next team version (invented roles,
> coordination, rules) to `plan/teams/<NN>/`, and the lead
> builds with it; an equal-budget test against a plain-rules
> hint decides whether the machinery stays.

---

## Why

The loop sees a stall but never asks why. Verified on main
at a61e201, 2026-11-04:

- `scripts/plan/motion.mjs` opens `Heartbeat: motion stalled`
  and `/march` Step 0.5 reacts with `alert` or `promote`
  (more work), never a diagnosis.
- `/next` Step 6's retro and `/refine` (spec 64) improve one
  verb's text. Nothing changes who does a spec's work: the
  lead and one builder (`skills/next/build.md`), `scout` and
  `reader` (`customization/sub-agents.md`), always.
- `identity/footguns.md`, the board (`scripts/board.mjs`,
  62.1-62.2) and `plan/ARCHIVE.md` keep traps, findings and
  closes. No file records a team design, why it was tried,
  and what it scored.

"Evolving Agent Teams" (arXiv 2610.36848, 2026-10-27) shows
the cost: on one scored task a single agent reached 0.51x of
the expert baseline, a fixed four-role team 0.31x, and a
supervisor that diagnosed each plateau and re-made the team
0.74x at the same budget. Source and mapping:
[`proposal/evolving-team-supervisor.md`](../proposal/evolving-team-supervisor.md).

## Design

- **`/evolve <spec>`**, a night verb, owner mode only, run
  under the dial (`Improve: bold`) like `/refine`. Never a
  bare `/march` dispatch except through `stall_action:
  evolve`.
- **Triggers** (`scripts/team/plateau.mjs` prints the specs
  due): a team version's `budget:` spent or its package
  ended; the nightly `/digest` sweep; a motion stall under
  `stall_action: evolve` (the spec that took the most tick
  time that week); a stuck spec (one chunk claimed twice
  with no close, two `FAIL` entries on one chunk, or a
  declared `Score:` flat under 2% over three evaluations).
- **Score.** A spec may declare `Score: <command>` in
  Contracts (prints one number, higher is better). Without
  one, the score is closes per week from `ARCHIVE.md` minus
  the spec's escapes in `plan/eval/ledger.md`, and the flat
  rule does not fire.
- **Diagnosis.** Exactly one cause from: `drift-easy-path`,
  `lost-knowledge`, `stuck-debugging`, `exhausted-search`,
  `premature-ceiling`, `stale-analysis`, `knowledge-gap`,
  `overload`, each with the evidence rule and default
  response in the proposal's table. No cited evidence is
  `KEEP_TEAM`, a normal outcome.
- **History.** `plan/teams/<NN>/v<k>.md`, one new file per
  version (front matter, Behavior, Reflection, Design,
  Outcome), plus `LEARNINGS.md` (board `FACT`s promoted,
  cited) and `SYNTHESIS.md`. Only `/evolve` writes there.
- **Roles are invented**, at most three per version until
  63.2 lands (a pipeline in one `/next` run), then parallel
  on fleet lanes within the width rule. Each role is one
  builder brief with a mandate, may-touch, must-not-touch,
  reads and writes. A role never widens permissions or
  touches a gate, a hard rule, `agents.md` or a path
  `surface.json` denies.
- **The Disciplinarian is a script.** `rules:` lines run in
  `scripts/team/discipline.mjs` after every builder commit;
  a violation reverts that commit in the worktree and
  writes a `FAIL`.
- **Two standing roles.** The Knowledge Integrator joins
  every version from v2 on and writes `SYNTHESIS.md`, which
  every later brief reads first. The Challenger joins on
  `exhausted-search` or `premature-ceiling`: it gets only
  the dead ends and ceiling claims, reproduces one on its
  own branch, and writes a `FACT` or a `FAIL`.
- **A worse version reverts.** A version scoring below its
  parent hands the next run the parent's design.
- **Test before templates.** Three arms, same model, budget,
  fixture and `Score:`, three runs each: A the evolving
  team; B the plain loop plus an `agents.md` hint block
  carrying the taxonomy as plain advice; C the plain loop.
  Team evolution stays only if A's median beats B's by 15%
  or more; otherwise B's hint, `LEARNINGS.md` and the
  Challenger prompt ship alone.

## Contracts

- `plan/teams/<NN>/v<k>.md` front matter: `spec`, `version`,
  `parent`, `trigger` (`finish | cron | stall | stuck`),
  `score_before`, `cause` (one taxonomy value or
  `KEEP_TEAM`), `budget`.
- Design lines: `- role: <slug> · mandate: … · may touch: …
  · must not touch: … · reads: … · writes: …`, then
  `coordination: solo | pipeline (<a> -> <b>) | parallel`,
  then `rules:` with `deny-path: <glob>`,
  `max-files-per-commit: <n>`, `require-test-touch`.
- `stall_action` in `plan/bearings.md`: `alert | promote |
  evolve | off`.
- `Score: <command>` in a spec's Contracts: one number on
  stdout, exit 0.

## Acceptance

- **A1** `scripts/team/version.mjs check` passes a well-formed
  team version and fails one with a missing field, an
  unknown cause, more than three roles before 63.2, or a role
  whose may-touch names a gate, `agents.md` or a denied
  `surface.json` path; its test covers each.
- **A2** `plateau.mjs` lists a spec for each trigger from
  fixtures (spent budget, nightly sweep, motion stall under
  `stall_action: evolve`, stuck chunk, flat `Score:`) and
  lists nothing for a spec that is moving.
- **A3** `/evolve <spec>` on a fixture spec writes `v<k+1>.md`
  naming one cause with cited evidence, or `KEEP_TEAM` and no
  file; the version passes A1's check.
- **A4** `/next` on a spec with a team version briefs one
  builder per role in pipeline order, runs `discipline.mjs`
  after each commit, and a commit breaking a `rules:` line is
  reverted with a `FAIL` on the board.
- **A5** From v2 on every version carries the Knowledge
  Integrator and every brief reads `SYNTHESIS.md` first; on
  `exhausted-search` or `premature-ceiling` it carries the
  Challenger, which writes a `FACT` or `FAIL` naming one
  claim and never commits to the main path.
- **A6** After 63.2, a `parallel` version runs its roles on
  separate lanes within `width.mjs`'s N, one branch each.
- **A7** `plan/eval/evolve.md` records arms A, B and C, three
  runs each at equal budget on the fixture, with medians and
  the keep-or-drop verdict by the 15% rule.
- **A8** If A7 keeps it: template twins, the `/evolve` row in
  `agents.md`, the knob in `plan/bearings.md`, a
  customization doc and the README tree entry; if A7 drops
  it: B's hint block and the Challenger prompt ship instead
  and this chunk says so.

## Open questions

- Fixture for A7: the default is a scratch repo with a slow
  pure function, correctness tests and a benchmark. Should
  one arm also run on an adopter spec with a real score
  (miserere-mei-deus's measured reports)?

## Chunks
Measure: 8 open · 0 closed · next A9

- [ ] **72.1** Team version format and its checker · S · closes A1 · needs —
- [ ] **72.2** `plateau.mjs` and the four triggers · M · closes A2 · needs 72.1
- [ ] **72.3** `/evolve`: diagnosis, reflection, next version · M · closes A3 · needs 72.2, 64.1
- [ ] **72.4** `/next` builds from a team version; discipline script · M · closes A4 · needs 72.3
- [ ] **72.5** Knowledge Integrator and Challenger standing roles · S · closes A5 · needs 72.4, 62.3
- [ ] **72.6** Parallel roles on fleet lanes · M · closes A6 · needs 72.4, 63.2
- [ ] **72.7** Equal-budget test against a plain-rules hint · L · closes A7 · needs 72.5
- [ ] **72.8** Ship what the test kept · S · closes A8 · needs 72.7
