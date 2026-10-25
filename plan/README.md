# nexus roadmap (nexus on nexus)

> What is still to build for the kit, one spec per initiative,
> each ending in chunks sized to one session. `/march` and
> `/ship-a-chunk` pick from here; a finished chunk leaves as
> one line in [`ARCHIVE.md`](ARCHIVE.md). The plan only
> shrinks. The shape is the one the kit teaches:
> [`concepts/plan-shape.md`](../concepts/plan-shape.md).

---

Style guardrails for every chunk: match the voice exemplars
in [`bearings.md`](bearings.md); every new doc discoverable
(linked + in the README tree) in the same commit; every new
invariant teaches the gate in the same commit; hard-wrap
~62–64 cols.

## Lanes

**Asap** (built before the table, in this order, once their
needs are done):


**Held** (waits on the owner's word; never picked until the
line goes; each line is a lock that times out, so it carries
`since:`, `until:` and `max_age:`):

- (none)

## Specs

| # | Initiative | Spec | Status | Progress |
|---|---|---|---|---|
| 55 | Cadence that actually delivers | [55-cadence-that-delivers.md](55-cadence-that-delivers.md) | planned · priority 2 | 1 left |
| 58 | One command keeps a project on the current kit | [58-upgrade.md](58-upgrade.md) | planned · priority 5 | 6 left |
| 59 | One improvement dial, and a loop that reads the field | [59-improvement-dial.md](59-improvement-dial.md) | planned · priority 6 | 5 left |
| 39 | The pull-request cloud loop, proven end to end | [39-cloud-loop-proven.md](39-cloud-loop-proven.md) | planned · priority 7 | 5 left |
| 60 | The fork stands on its own | [60-fork-stands-alone.md](60-fork-stands-alone.md) | planned · priority 8 | 2 left |
| 61 | A judge in the gate | [61-judge-in-the-gate.md](61-judge-in-the-gate.md) | planned · priority 9 | 7 left |
| 62 | The typed board | [62-typed-board.md](62-typed-board.md) | planned · priority 10 | 6 left |
| 63 | The unattended fleet | [63-unattended-fleet.md](63-unattended-fleet.md) | planned · priority 11 | 6 left |
| 64 | The editable surface and /refine | [64-surface-and-refine.md](64-surface-and-refine.md) | planned · priority 12 | 6 left |
| 65 | The GUI sees the new parts | [65-gui-sees-the-new-parts.md](65-gui-sees-the-new-parts.md) | planned · priority 13 | 5 left |
| 66 | Context as files, mission as a pointer | [66-context-trees.md](66-context-trees.md) | planned · priority 14 | 4 left |

Spec numbers continue from the v1 phase numbers (phases 1–33
are archived; 20 and 32 were the two left blocked when the
plan moved to chunks on 2026-10-20). The next new spec is 67.
New specs arrive through `/plot`, `/messy`, or `/oversight`
promoting a [`CANDIDATES.md`](CANDIDATES.md)
entry. A row whose Status reads `planned · priority N` is
picked after the Asap lane, `priority 1` first; the other
rows follow in table order.

> **When no chunk is ready,** `/march` transitions to
> `/iterate`: the audit dimensions (drift, completeness, voice,
> friction, freshness, lessons) always have food, and
> `/expand` grows the candidates from evidence.

## Chunks, measure, archive

- A chunk line: `- [ ] **NN.k** <title> · S|M|L · closes A1 ·
  needs —`. S ≈ an hour, M a few hours, L one session at most.
- Closing a chunk, in its shipping commit: line out, its A-IDs
  out, the `Measure:` line fixed, `needs` and lanes cleaned,
  the row's `N left` updated, one line in `ARCHIVE.md`.
- A spec with nothing left: its lasting rules move into
  `bearings.md` or the doc it shipped, the file is deleted,
  and the archive gets `· NN · spec complete: …`.
- The gate's `chunks` leg (`node scripts/verify.mjs`) checks
  all of it against HEAD.

## Carry-overs

- [`reference/`](reference/README.md) holds the harness
  comparison behind specs 60-66; donor code is fetched into
  `.scratch/`, never vendored.

- `AUDIT.md`'s Pending section holds iterate-sized findings;
  they wait until no chunk is ready. Read the file for the
  live count.
- `CANDIDATES.md`'s Pending section holds candidates
  awaiting `/oversight` promotion into specs. Read the file
  for the live count.
- Workflow-file pushes: the cloud tick's token can't push
  `.github/workflows/*.yml` (see `agents.md` "Operational
  secrets"), so chunks that touch them ship from a local
  session (each says so in a sub-bullet).
