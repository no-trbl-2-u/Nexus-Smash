# Proposal: an evolving-team supervisor (stall, diagnose, redesign)

Status: draft, asked for by TJ on 2026-11-04; plotted as spec 72 (`plan/72-evolving-team-supervisor.md`) in the same pull request.
Source: Cao, Mao, Li, Gonzalez, Stoica, "Evolving Agent Teams", arXiv 2610.36848 (https://www.alphaxiv.org/abs/2610.36848, read 2026-11-04). Code: https://github.com/caoshiyi/EAT (not read).

## Problem
The loop notices that it stopped shipping, but it never asks why, and it never changes how it works when it is stuck.

What exists today (read on main at a61e201, 2026-11-04):
- `scripts/plan/motion.mjs` judges a full ISO week against a 4-week baseline and opens `Heartbeat: motion stalled`. `/march` Step 0.5 reacts with `alert`, or `promote` (more work from `CANDIDATES.md`). Neither diagnoses the stall.
- `/next` Step 6 runs a retro per run (failed commands, wrong assumptions). `/refine` (spec 64, `Improve: bold`) reads the last three runs of one verb and proposes edits to that verb's text. Both act on one verb's procedure, never on who does the work.
- The team is fixed: the lead decides, one builder builds (`skills/next/build.md`), `scout` and `reader` sub-agents fetch (`customization/sub-agents.md`). `/next batch` runs one Workflow per chunk; `packages/cli/server/fleet.mjs` runs attended parallel sessions; spec 63 plans unattended lanes.
- Shared memory exists but is about traps, not strategy: `identity/footguns.md` (the 2x ladder), `customization/lessons-layer.md` (adopter option), `plan/AUDIT.md`, `plan/DIGEST.md`, `plan/ARCHIVE.md`. Spec 62's board (`scripts/board.mjs`, 62.1 and 62.2 built) carries typed `FACT`, `FAIL` and `PATCH` entries within a spec. Nothing records the team design that was tried, why, and what it scored.

The paper's finding is the gap: strong single agents and fixed role teams both converge to local optima (on their MLA decode task, 0.51x for Claude Code alone, 0.31x for a fixed four-role team, 0.74x for the evolving team at matched budget). Their failure modes map onto nexus specs that grind: drifting to an easier path, losing an insight in one run's report, debugging a blocker that eats every session, tuning on stale analysis.

## The paper's loop, in nexus terms

| Paper | nexus today | This proposal |
|---|---|---|
| Supervisor, run when a team finishes or on a timer | `/march` tick, `/digest` nightly, motion stall | `/evolve <spec>`, a night verb, triggered by four signals (below) |
| Monitor scores and agent reports | `pulse.mjs`, `motion.mjs`, the escape ledger | A spec's own `Score:` command, plus the existing signals |
| Reflect, diagnose the plateau | retro per run | A fixed diagnosis taxonomy with evidence rules |
| Redesign roles, coordination, knowledge | fixed lead + builder | A team version file the lead turns into builder briefs |
| File system K: learnings, evolution history, artifacts | footguns, board, ARCHIVE | `plan/teams/<NN>/`: `v<k>.md` history, `LEARNINGS.md`, `SYNTHESIS.md`; artifacts stay where they are (branches, PRs, board) |
| Invented roles (Disciplinarian, Challenger, Knowledge Integrator, ...) | none | Invented per version, under guardrails; two standing roles |

## Design

### 1. Triggers
`/evolve` runs for one spec at a time when any of these holds:
1. Team finished: a `/heads-down` package or a `/next batch` on the spec ends, or the team version's own budget (`budget:` in its file) runs out.
2. Periodic: `/digest` runs `scripts/team/plateau.mjs` across open specs every night.
3. Motion stall: `stall_action` gains a fourth value, `evolve`. Under it, `/march` Step 0.5 runs `/evolve` on the spec that took the most tick time in the stalled week instead of promoting new work.
4. Stuck spec: the same chunk claimed twice with no close, two `FAIL` board entries on one chunk, or the spec's `Score:` flat (under 2% change) over its last three evaluations.

### 2. The score
A spec may declare `Score: <command>` in its Contracts. The command prints one number, higher is better (a benchmark, a test-pass rate, a game balance metric). With no `Score:`, the score is the spec's chunk closes per week from `ARCHIVE.md`, minus its escapes in `plan/eval/ledger.md`. Most kit specs have no real score and should never trigger 4 on score; that rule only bites specs that declare one.

### 3. Diagnosis taxonomy
`/evolve` must name exactly one primary cause from this list and cite evidence (commits, board entries, retro lines). No evidence means `KEEP_TEAM`, a valid outcome, as `KEEP_BASE` is for `/refine`.

| Cause | Evidence rule | Default response |
|---|---|---|
| `drift-easy-path` | the spec's Design names a hard constraint and recent commits route around it, or acceptance text was weakened | Disciplinarian with that constraint as a rule |
| `lost-knowledge` | a `FACT` or retro line from an earlier version is contradicted or redone later | Knowledge Integrator; `SYNTHESIS.md` made mandatory reading |
| `stuck-debugging` | one blocker holds two or more versions or sessions | split: a focused debugger on its own branch (forbidden from main code) plus an optimizer that keeps shipping around it |
| `exhausted-search` | the last three versions changed only parameters, gains under 2% | Challenger; widen the search (new primitive study) |
| `premature-ceiling` | a run claims "cannot", "limit" or "max" with no measurement behind it | Challenger re-tests the claim |
| `stale-analysis` | a structural change landed and tuning continued on pre-change measurements | re-profile first, solo, profile-before-change rule |
| `knowledge-gap` | repeated failures at one API or primitive | Primitive Study role: small tests only, writes `FACT`s |
| `overload` | one role's brief covers three or more kinds of work and its runs end mid-step | split roles |

### 4. Team version history
`plan/teams/<NN>/v<k>.md`, one new file per version (a new file conflicts with nothing). Written only by `/evolve` in owner mode, like `plan/DIGEST.md`.

```md
---
spec: 72
version: 3
parent: 2
trigger: stuck
score_before: 0.42
cause: lost-knowledge
budget: 4 ticks
---
## Behavior
Evidence, cited (commit shas, board ids, retro lines).
## Reflection
Why the cause holds, in three sentences or fewer.
## Design
- role: knowledge-integrator · mandate: ... · may touch: plan/teams/72/SYNTHESIS.md · must not touch: src/ · reads: v1-v2, board · writes: SYNTHESIS.md
- role: optimizer · mandate: ... · may touch: ... · must not touch: ...
coordination: pipeline (integrator -> optimizer)
rules:
- deny-path: src/legacy/**
- max-files-per-commit: 3
## Outcome
Filled by the next /evolve: score_after, kept | reverted, what it taught.
```

`LEARNINGS.md` holds empirical observations promoted from the board's `FACT` entries (deduplicated, dated, cited). `SYNTHESIS.md` holds the Knowledge Integrator's plan connecting them. Per-team artifacts stay where they live: branches and PRs (each named in Outcome), board entries tagged `team:v<k>`.

### 5. Role invention, with guardrails
The supervisor invents roles; there is no fixed pool. The lead turns each role into one builder brief (`skills/next/build.md` §2 gains a mandate block). Guardrails, all checked by `scripts/team/version.mjs`, not by the model:
- A role never widens permissions, never edits a gate, a hard rule, `agents.md`, or a path `surface.json` denies (spec 64's rule, reused).
- At most three roles per version until spec 63 lands, run as a pipeline inside one `/next` run; after 63, parallel roles take fleet lanes and the width rule.
- Every version has a `budget:`; the next `/evolve` runs when it is spent.
- A version that scores below its parent is reverted to the parent's design for the next run, and the Outcome says so.

### 6. The Disciplinarian is a script
The paper's Disciplinarian blocked non-compliant commits after every commit. Here the version's `rules:` lines are checked by `scripts/team/discipline.mjs` after each builder commit (path denies, files per commit, a required test touch). The lead runs it like the gate; a violation reverts that commit in the worktree and writes a `FAIL`. Mechanical first, in the kit's own spirit: a rule seen twice becomes automation.

### 7. Two standing roles
- Knowledge Integrator: once a spec has two or more versions, every new version includes it. It reads all `v<k>.md`, the board and `LEARNINGS.md`, and writes `SYNTHESIS.md`. Every later role's brief starts by reading it. This is the paper's V7 to V8 fix (an insight sat in one team's report and the next three teams ignored it).
- Challenger (fresh eyes): whenever the cause is `exhausted-search` or `premature-ceiling`. It gets no build context, only the list of dead ends and ceiling claims from the history. Mandate: pick one, reproduce it, try to break it, on its own branch. Output: a `FACT` (the claim holds, with the measurement) or a `FAIL` naming the claim. It never edits the main path. `/critique` already plays the stranger for adoption; this points the same fresh eyes at the spec's own dead ends.

### 8. Test it against plain rules first
The paper compared against a single agent and a fixed team, but never against the cheapest alternative: the same single loop with the supervisor's know-how written as plain hints in `agents.md`. If that matches the evolving team, nexus should ship the hints and skip the machinery.

Three arms, same model, same budget (tokens, read from the run's usage), same fixture, same `Score:`, three runs each (the paper ran two):
- A: evolving team (`/evolve` on, standing roles on).
- B: plain loop plus an `agents.md` hint block: the taxonomy above as "when you stall, name the cause, write a FACT, re-read LEARNINGS, revisit one dead end, profile before tuning". No supervisor, no roles.
- C: plain loop, no hint.

Fixture: a self-contained scratch repo with a deterministic `Score:` command (a slow pure function with correctness tests and a benchmark), built so a single session plateaus. Decision rule: keep team evolution as a feature only if A's median beats B's median by 15% or more; otherwise ship B's hint block, `LEARNINGS.md` and the Challenger prompt, and drop the rest. Results go to `plan/eval/evolve.md`.

## File ties
- New: `skills/evolve.md`, `.claude/commands/evolve.md`, `scripts/team/plateau.mjs`, `scripts/team/version.mjs`, `scripts/team/discipline.mjs` (+ `scripts/__tests__`), `plan/teams/`.
- Touched: `scripts/plan/motion.mjs` (`stall_action: evolve`), `skills/march.md` Step 0.5, `skills/digest.md` (nightly plateau line), `skills/next.md` and `skills/next/build.md` (role briefs, discipline check), `plan/bearings.md` (the knob), `agents.md` skill table, README tree.
- Reused, unchanged: `scripts/board.mjs` (62), the fleet lanes (63), `surface.json` and `/refine`'s guardrails (64), the escape ledger (61).
- Templates last, and only if the experiment says keep.

## Risks
- Cost: each `/evolve` is a long model call; a team of three runs three briefs. Bound it with `budget:` and run it under the night workflow's quota skip (spec 64's pattern).
- Rule gaming: the paper saw one attempt (blocked by its supervisor). Here the discipline script is the referee, not a role, so a role cannot argue past it.
- Noise: kit specs mostly have no numeric score; triggers 2 and 4 on score stay quiet for them. The value is likely highest for adopter specs with a real benchmark (confidence 60, inferred from the paper's tasks all being scored optimization).
- The paper's evidence is kernel and robotics optimization with real scores, two runs per setting (their stated limitation). Transfer to a methodology kit is unproven, which is why the experiment comes before templates (confidence 85 that transfer is the main open risk).
- Overlap with spec 64: `/refine` evolves a verb's text, `/evolve` evolves who does a spec's work. They share guardrails and must not edit each other's files.
