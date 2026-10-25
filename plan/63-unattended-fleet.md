# 63 — The unattended fleet

> The cloud loop runs N contributor lanes at once, each on
> its own claim, worktree and branch, each landing through
> the judge; the owner's settle stays the only writer to
> shared plan files; and the width follows the week's quota.

## Why

The kit already has every part of a fleet except permission
to run it unattended. Claims cannot double-win
(`scripts/claims.mjs`); each GUI session gets its own
worktree and branch (`packages/cli/server/fleet.mjs`);
pending files mean no branch edits a shared plan file
(`scripts/plan/settle.mjs:2-4`); ledgers and the reboot train
survive crashes (`customization/sessions.md`). Yet
`concepts/loop-shapes.md:172-175` still rules the swarm out
("N unattended writers on one branch ... every collision is
a divergence stop"), and the cloud runs one writer at a time
(`concurrency: group: march` across `march.yml` and
`night.yml`). The doctrine's premise, a shared branch with no
referee, no longer describes the kit.

The evidence that width pays is external and bounded: a
research harness (MIT, 2026-10) raised a six-hour
test-pass rate from 34% to 55% by scaling identical workers
on a shared repo. Its workers self-merged with no approvals;
the gain is real and the merge policy is the risk. Spec 61
puts a judge in front of every lane's PR, which is what makes
this spec safe to build.

Width without a quota rule is a lockout: the kit's own data
shows 40 cloud runs failed during the 2026-10-15 weekly
lockout (`templates/scripts/cloud/quota.mjs`). N lanes share
one `seven_day` reading.

## Design

- **Lanes are contributor ticks.** `march.yml` gains a
  `lanes` job with `strategy.matrix.lane: [1..N]`, each step
  running `/next top` in contributor mode (no `.owner`; the
  checkout name is `lane-<n>`), claiming by compare-and-swap,
  building in its own worktree on `next/<id>`, and opening a
  PR. The existing `march` job stays the single owner tick
  that triages, sweeps vetoes and settles pending files.
- **Width from quota.** `scripts/cloud/width.mjs` reads the
  cached `seven_day` utilisation and the open-PR count and
  prints N: `NEXUS_LANES` as the ceiling, minus one lane per
  10% of quota above 60%, minus open PRs over the PR cap
  (`NEXUS_PR_CAP`, default 5); never below 0. The matrix is
  built from its output.
- **No two lanes on one spec's shared lines.** A lane never
  edits `plan/`, `identity/` or `.github/` directly; closes
  are pending files; a chunk whose `needs` is held by another
  open PR is skipped (`concepts/plan-shape.md` "Extending a
  spec from a branch").
- **Doctrine rewrite.** `concepts/loop-shapes.md` replaces
  the swarm paragraph with "the fleet": N unattended writers,
  one per branch, one per claim, every one through the judge,
  one owner settling. The firehose and oracle stay ruled out.
- **The GUI sees the lanes.** The Fleet screen lists cloud
  lanes as tiles from the Actions run (lane, chunk, PR,
  judge state) beside local sessions; the Cloud screen's
  step shows width and why (quota, cap).
- **Stop conditions.** A lane whose PR is red twice leaves it
  for `review-fix` and releases the claim; three lanes
  skipping in one tick file one AUDIT row, not three.
- **Templates.** The matrix job and `width.mjs` ship as twins
  behind `NEXUS_LANES` (unset or `1` means today's behaviour).

## Contracts

- Variables: `NEXUS_LANES` (ceiling), `NEXUS_PR_CAP`
  (default 5).
- `node scripts/cloud/width.mjs [--json]` prints N and the
  reasons.
- Lane checkouts are named `lane-<n>`; their PRs are
  `next/<id>` like any contributor's.

## Acceptance

- **A1** `width.mjs` prints the ceiling at low quota and no open PRs, one fewer lane per 10% of quota above 60%, and 0 at or above the governor's cap; its test covers each band.
- **A2** With `NEXUS_LANES=2`, one scheduled tick opens two PRs for two different chunks, each with a pending close, and no lane commit touches `plan/`, `identity/` or `.github/` directly.
- **A3** Over one week at `NEXUS_LANES=2`, zero merge conflicts on `plan/*` between lanes and zero duplicate claims, measured from the claims branch history and the merged PRs.
- **A4** `concepts/loop-shapes.md` describes the fleet and no longer rules out unattended width; `plan/bearings.md` carries the lane rules; the README tree links both.
- **A5** The Fleet screen shows cloud lanes as tiles and the Cloud screen shows width and reason; the GUI's particles, colour and motion stay.
- **A6** Template twins exist behind `NEXUS_LANES`; an adopter with it unset sees one writer as before.

## Open questions

- **Q1** Does the owner's settle run on a schedule or only on the owner tick? Default until answered: the owner tick settles, so pending files wait at most one cadence step.

## Chunks
Measure: 6 open · 0 closed · next A7

- [ ] **63.1** `width.mjs` and its bands · S · closes A1 · needs 61.7
- [ ] **63.2** The `lanes` matrix job in contributor mode · M · closes A2 · needs 63.1, 62.3
  - Workflow file: ships from a local session (cloud token).
- [ ] **63.3** One week of two lanes, measured · M · closes A3 · needs 63.2
- [ ] **63.4** The fleet replaces the swarm paragraph · S · closes A4 · needs 63.2
- [ ] **63.5** Fleet and Cloud screens show lanes · M · closes A5 · needs 63.2
  - Keep the GUI's particles, colour and motion.
- [ ] **63.6** Template twins behind `NEXUS_LANES` · S · closes A6 · needs 63.3, 63.4
