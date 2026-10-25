# 65 — The GUI sees the new parts

> The board, the fleet's cloud lanes and a refinement's
> proposals are read in the GUI through the repo's own
> scripts, with the owner's keep-or-veto for a refinement
> living in the Oversight inbox like any other question.

## Why

The GUI reads the plan, claims and announcements only through
the repo's own scripts (`packages/cli/server/plan.mjs:1-19`,
"so the board never disagrees with /next"). Specs 62 to 64
add three new states the GUI cannot show: typed board entries,
cloud lanes, and a `/refine` run's candidates and verdict.
Without screens for them the owner reads them in a terminal,
and the Oversight badge undercounts what needs the owner.

The 45 Claude Design handoff boards in
`packages/cli/design/handoff/` are the source of truth for
fidelity; new panels follow the existing board shapes
(Board, Cockpit, Inbox, CloudLoop) rather than inventing
layouts.

## Design

- **Board tab on `/board`.** A second tab beside the chunk
  list: entries from `node scripts/board.mjs read --all
  --json`, grouped by chunk, `FAIL` first, `(xN)` counts,
  `invalidated` struck, `unfold` on click, a grep field that
  runs `board.mjs grep`. A chunk tile in the first tab shows
  a red dot when an open `FAIL` names it.
- **Lane tiles on `/`.** Fleet shows each cloud lane from the
  current Actions run (`gh run view --json`) as a tile with
  lane number, chunk, PR, judge state and the width reason
  from `width.mjs --json`; the Cloud screen's live step
  shows "width N: <reason>".
- **Refinement view on `/s/<id>`.** When a session's beats
  include `refine propose|probe|select|adopt`, the cockpit's
  agent stage draws the candidates as filaments and the
  selection as the junction; a side panel lists each
  candidate's anonymized outcome row and, after selection,
  the diff. The owner's keep-or-veto is a question in the
  Oversight inbox with a default of `keep` after the
  six-minute rule, answered through `plan-answers.mjs` like
  any plan question; the badge counts it.
- **Beats.** `shared/beats.mjs` gains the `refine` family and
  `lane start|pr|judge|end`; the reducer stays pure and
  replayable; one demo scenario `refine-night` and one
  `fleet-of-two` join the twelve.
- **Walk.** `npm run walk` covers the new routes and tabs;
  dimension H reads them like any other.
- **Magic guard.** No panel removes or dims `src/fx/*`,
  colour or motion.

## Contracts

- Routes: `/board?tab=board`, existing `/`, `/cloud`,
  `/s/<id>`; no new top-level route.
- Beats: `refine propose|probe|select|adopt`, `lane
  start|pr|judge|end`.
- Demo scenarios `refine-night`, `fleet-of-two`.

## Acceptance

- **A1** The Board tab lists entries grouped by chunk with counts, struck invalidated patches, unfold and grep, all through `board.mjs`; a chunk with an open `FAIL` shows the dot.
- **A2** Fleet shows cloud lanes as tiles with chunk, PR and judge state; the Cloud screen shows width and reason; both read the repo's scripts and `gh`.
- **A3** A `/refine` session's candidates and selection are drawn from beats; the keep-or-veto question appears in the Oversight inbox, counts in the badge, defaults to keep after six minutes, and its answer reaches the session.
- **A4** The beats reducer test covers the two new families; `refine-night` and `fleet-of-two` run under `--demo` with no repo and no network; `npm run walk` over all scenarios reports zero console errors and zero `noAlt` rows at both viewports.
- **A5** No diff under `packages/cli/src/fx/` removes a file; particle, colour and motion CSS are unchanged.

## Open questions

(None.)

## Chunks
Measure: 5 open · 0 closed · next A6

- [ ] **65.1** Board tab and the chunk dot · M · closes A1 · needs 62.2
- [ ] **65.2** Lane tiles and the width line · M · closes A2 · needs 63.2
- [ ] **65.3** Refinement filaments and the keep-or-veto question · L · closes A3 · needs 64.3
- [ ] **65.4** Beats, two demo scenarios, the walk · M · closes A4 · needs 65.1, 65.2, 65.3
- [ ] **65.5** Magic guard check across the spec's diffs · S · closes A5 · needs 65.4
