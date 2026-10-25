# Harness-Mash — synthesis: Nexus × Harness² × Agensh

2026-10-25, **revision 2** (Nexus re-read from upstream `daretodave/nexus` head 3ccda50 of the same day; the first revision used a stale 2026-09-02 fork and is superseded). Built from the three source-cited profiles in this folder. Every claim traces to a file in one of the three clones in `Harness-Mash/`.

Lineage note: the production instance in `Miserere-mei-deus` (MMD) is a v1 "phase plan" repo that diverged from upstream. Upstream is v2 (specs + chunks, `plan/nexus.lock`). Future projects would adopt upstream v2, so **upstream is the spine here**; MMD-only machinery (partitioned adversarial review, eval ledger, telemetry shards) is listed as a fourth donor where relevant.

---

## 0. The one-line answer

**Feasible, and smaller than it looked.** Nexus upstream already has a GUI, a fleet of claimed parallel sessions, a mid-turn steering channel, a mechanised 2×-automate ladder, a veto-gated self-growing plan, and cloud cost governors. That covers roughly half of what the first revision proposed grafting. What remains genuinely missing, and what the donors are each best at, is:

- **From Agensh:** a *typed, deduplicated, unread-cursor shared findings board* (Nexus has claims and a free-text notice board, not typed FACT/FAIL/PATCH_SUMMARY with dedup), and running the fleet **unattended** in the cloud (Nexus's fleet is attended by doctrine and the cloud runs one writer).
- **From Harness²:** *probe-before-adopt* for edits to the harness's own skill text, a *formal editable surface*, *blind selection*, and *confounded verdicts*. Nexus's spec 59 "Improve: bold — nexus itself" is the exact slot this fills and is 0 of 5 built.
- **From MMD into upstream:** the eval ledger (a loop that measures its own judges) and partitioned adversarial review. Without the eval ledger, a Harness²-style refiner has no outcome judge, which is Harness²'s own worst flaw.

Neither donor can be the spine: Harness² is an optimizer above an agent, Agensh is coordination around N agents, both Linux-only, provider-locked, UI-less, and benchmark-coupled. The merge is re-implementing their patterns as Nexus scripts, lanes, generators and GUI screens behind flags. Not imports.

---

## 1. Layer map

```
  OPTIMIZER      Harness²: edits the agent's config tree per task, probes, composes,
  (above)        blind-selects, writes EXPERIENCE library          → Nexus slot: spec 59 "Improve"
                                 │
  RUNTIME +      Nexus upstream: Claude Code + skills/ + plan v2 + identity/ + guard/steer hooks
  METHOD +       + /march→/next dispatcher + claims branch + fleet of star sessions
  HUMAN + GUI    + @usenexus/cli (React GUI over the Agent SDK) + cloud governors
                                 │
  COORDINATION   Agensh: typed board, per-worker durable event router, git+chat bus,
  (around)       TTL claims, nudges                               → Nexus slot: claims.mjs + announce.mjs + fleet
```

Harness² and Agensh remain orthogonal to each other. Nexus now overlaps materially with both, which is new since revision 1.

---

## 2. Capability matrix

| Capability | Nexus upstream (3ccda50) | Harness² | Agensh |
|---|---|---|---|
| **Unit of work** | one chunk, S/M/L, closes an acceptance ID (`skills/next.md:3-7`) | one (benchmark, task): 4k rollouts + 3k editor sessions (`core/ledger.py`) | one ACP turn = unread board snapshot + ≤32 events (`dispatcher.ts:302-399`) |
| **Loop driver** | `/march`: pre lanes → triage → critique → `/next top` → queue lanes → expand → iterate; Step 0 veto sweep, Step 0.5 motion react (`skills/march.md:13-19,75-124`) | sequential tasks per domain, domains threaded (`core/schedule.py`) | event-driven; idle until a Gitea/Mattermost event or nudge (`dispatcher.ts`) |
| **Stop condition** | per-verb Failure-modes list; pending files; blocked is loud (`plan/bearings.md:165-170`) | fixed budget, never early (`ledger.py`) | wall clock only (`pbench_run.sh:628-640`) |
| **State store** | Markdown in git (`plan/`, `identity/`), `claims` orphan branch, untracked `.nexus/` ledgers | plain files under `runs/`, content-fingerprinted (`core/runmark.py`) | MySQL events + board_gists, Copilot SQLite, Gitea |
| **Cross-run memory** | footguns ladder + decisions in `identity/`, AUDIT/CRITIQUE/CANDIDATES, ARCHIVE (`identity/footguns.md`; `scripts/plan/settle.mjs:14-17`) | per-domain library of adopted trees + EXPERIENCE.md, prefix-only (`core/library.py`) | **—** by design |
| **Within-run shared context** | claims (CAS, 24h TTL, `s:{session}~{star}`) + free-text `.announcements.md` notice board + per-session ledgers (`scripts/claims.mjs:2-22`; `customization/sessions.md`) | filesystem evidence tree per editor session (`core/context.py`) | typed capped gists OBSERVED/FACT/FAIL/CLAIM/PATCH_SUMMARY, dedup `(xN)`, unread cursors, grep, unfold (`board-service/shared_lessons.py`) |
| **Mid-turn delivery to a running agent** | **yes**: `steer.mjs` PreToolUse deny with the owner's line as reason; UserPromptSubmit additionalContext (`templates/claude/hooks/steer.mjs:1-20`) | **—** | yes: MCP result shim appends DMs and peer gists (`mcp-notice-shim.cjs`) |
| **Self-improvement target** | queues, plan (aged promotion), footgun→automate chunk, skill text via retro; **never its own gates** (`agents.md`) | agent's 8 config files in an allow-listed `SurfaceSpec` (`substrate/opencode.py` L42-88) | **—** |
| **Self-improvement judge** | human (`/oversight`, veto issues, settle on main) + verify gate; **no eval ledger upstream** (MMD has one) | LLM composer + blind LLM selector; **judge never feeds back** (`core/judge.py` L15-18) | **—** |
| **Probe-before-adopt of harness edits** | **—** (retro edits a skill on one tick's evidence) | yes, k re-rolls per candidate (`core/recursion.py`) | **—** |
| **Parallelism** | fleet: 2-3 `/heads-down` sessions + GUI + terminal, each in own worktree `nexus/{star}-{n}`, claims keep them apart; `/next batch` one Workflow per chunk (`packages/cli/server/fleet.mjs:4-14`) | k INV + k DOM candidates → k compositions | N identical static workers, 1,024 in paper, single node in code |
| **Unattended parallelism** | **—**: "One unattended writer per branch, always" (`concepts/loop-shapes.md:172-175`); cloud `concurrency: group: march` | n/a | yes, that is the whole system |
| **Work claiming** | enforced: CAS on `claims` branch, 8 retries, TTL, PR claims never expire, owner `--force` | **—** | advisory `CLAIM` gist, 1h TTL |
| **Merge policy** | owner lands on main + settles pending; contributor PRs via conventional `pr-flow.yml`; MMD adds judge + partitioned review + auto-merge on pass | LLM composition, no programmatic merge | self-merge, 0 approvals, CI gate disabled (`bootstrap.sh:272-291`) |
| **Human checkpoints** | GUI Oversight inbox (live asks, permissions, parked and plan questions), Grill-me, wand, breakout, 6-min auto-default; `loop:veto` issues; owner-only settle | **—** (post-hoc report) | **—** (asking forbidden, `allow_once`) |
| **Permission posture** | committed deny walls + guard + steer; D4 lets GUI start sessions in `bypassPermissions` per checkout (`identity/decisions/2026.md`) | `--dangerously-skip-permissions`, Codex sandbox off | `--no-ask-user`, auto-allow |
| **Cost control** | **quota governor** on subscription `seven_day` (nexus cap 0.80, default 0.90; weekly-lockout pause issue; evidence: 40 runs failed in the 2026-10-15→19 lockout, 36% of ticks were paid no-ops), **idle fingerprint skip** (backoff 3, wake every 4), weighted ceiling 20/24h, lost-to-background mark, Haiku-only GUI helpers, per-session model/effort in the GUI. **No model tiering in CI**: every workflow pins `claude-sonnet-5`, no `--effort` (`templates/scripts/cloud/{quota,idle,lost}.mjs`; `.github/workflows/*.yml`) | fixed structural budget; USD summed; no token cap | time only; one pinned model |
| **Anti-lull** | motion pulse vs 4-week baseline, `stall_action: promote`; refill lane runs generators; aged promotion behind veto (`scripts/plan/{motion,refill,promote}.mjs`) | n/a (never idle) | idle DM at 600s; "published nothing" nudge |
| **Observability** | GUI Fleet/Cockpit (beat-driven orb stage)/Git/Cloud/Recover; `pulse.mjs --motion`; DIGEST; heartbeat issues; **no telemetry shards upstream** | print + full on-disk audit; `similarity` collapse metric; no UI | stderr + `/healthz` + archives; no UI |
| **UI** | **`@usenexus/cli`**: local React 19 GUI, 13 routes, Agent SDK-hosted sessions, SSE with secrets mask, 12 demo scenarios, GIF recorder, `npm run walk` (`packages/cli/`) | **—** | **—** (hosted replay only) |
| **Loop observes its own UI** | yes: cloud tick builds CLI, walks demo screens in headless Chrome, uploads `walk.json` + PNGs; `/iterate` dim H specified (`packages/cli/scripts/walk.mjs`; spec 56, 5/10) | n/a | n/a |
| **Extensibility** | npm adopt + GUI onboarding; **project lanes** (`skills/march.lanes.md` blocks the kit never overwrites); generators listed in bearings; `settle.json`; `upgrade` dry-run (`scripts/plan/lanes.mjs`; `scripts/upgrade-plan.mjs`) | `BenchmarkAdapter` + `Substrate` protocols | MCP server template + env plumbing; ProgramBench-only |
| **Provider** | Claude Code login, no API key; Sonnet 5 in cloud, Haiku helpers | Vertex-centric; WB refuses non-Gemini | Copilot + OpenAI Responses only |
| **Platform** | Windows-aware (`SIGBREAK`, `rundll32`, `dualshell` leg) | POSIX only | Linux + Docker + systemd + sudo |
| **Failure recovery** | ledgers survive crashes, park/resume, reboot train, Recover screen replays Workflow journals, heartbeat cancels wedged runs, half-made worktrees finished in place | retries, fingerprinted resume | durable queue state machine, session restore, sealed archives |
| **Secrets** | names-only manifest `nexus.secrets.json`, vault, sinks, one mask over every SSE frame, `secrets scan --staged` gate (`scripts/secrets.mjs`) | Anthropic keys stripped, Vertex ADC | egress proxy injects real key; workers hold a dummy |
| **Tests** | kit 56 node test files + CLI 103, `cli-ci.yml`, `scripts-ci.yml`, `probe.yml` latency | 5 plumbing tests | **none** |
| **In production** | yes, kit's own loop alive (896 commits in 7 weeks) | no | no |

---

## 3. Boundaries and overlap

### 3.1 Nexus ∩ Agensh — more overlap than revision 1 saw, same fault line

| Idea | Nexus upstream | Agensh | Verdict |
|---|---|---|---|
| Claim | CAS commit on orphan branch, 24h TTL, PR claims never expire, owner force-take | 100-char gist, 1h TTL, advisory | **Nexus is strictly stronger.** Nothing to import here |
| Shared findings | `.announcements.md` free text; AUDIT/CRITIQUE append-only files | typed gists, dedup with `(xN)`, `PATCH_SUMMARY` replace-by-`delegation_id`, `FAIL` invalidates a patch, unread cursor per reader, grep over history | **Agensh wins.** This is the one Agensh subsystem with no Nexus equivalent |
| Mid-turn interrupt | `steer.mjs` PreToolUse deny; owner-addressed only | MCP result shim; DMs + peer gists | Nexus's mechanism is better (native hook, no shim) but carries only the owner's lines. Widen it to carry board notices |
| Fleet | 2-3 attended sessions + GUI, each own worktree and branch | N unattended identical workers | Nexus has the plumbing (claims, worktrees, ledgers, star names). What it lacks is *permission* to run them unattended |
| Quiet worker | heartbeat (6h), motion pulse (weekly), idle skip | idle DM 600s, "published nothing this turn" nudge | Complementary granularities. Nexus's are model-free; Agensh's are per-turn |
| Merge | owner → main; contributor → PR through `pr-flow.yml` | self-merge, 0 approvals | **Nexus wins**, but note upstream's PR gate is conventional. MMD's judge + review is the strong version |
| Durable events | GitHub issues/labels + `.nexus/feed/feed.jsonl` | MySQL state machine with dedup key + retry | Agensh is more robust to transport failure. Low priority: GitHub is the bus by choice |

**The fault line, restated for upstream.** `concepts/loop-shapes.md:172-175` still says the swarm does not earn its place because "unattended, every collision is a divergence stop." But upstream has since built the thing that prevents collisions: CAS claims per chunk, per-session worktrees and branches, pending files so "no branch ever writes a shared plan file" (`settle.mjs:2-4`). The doctrine's premise (shared branch, no referee) no longer describes the kit. Agensh's result rests on exactly what Nexus refuses (self-merge, no gate), so the reconciliation is: **N unattended `/next` lanes, each on its own branch and claim, every one landing as a contributor PR through the gate, with the owner's settle as the single writer to shared plan files.** The cloud `concurrency: group: march` becomes a matrix with the PR cap as width.

### 3.2 Nexus ∩ Harness² — both grow the harness; Nexus grows the *plan*, Harness² grows the *agent config*

| Dimension | Nexus upstream | Harness² |
|---|---|---|
| What self-modifies | the plan (aged promotion), the queues, footgun→automate chunks, skill text by retro | the agent's prompts/skills/scripts/plugins |
| Trigger | a silted queue, a stall, a 2× footgun | every task |
| Editable surface | implicit; gates/ceilings/hard rules forbidden by prose | explicit `SurfaceSpec`, char caps, mechanical validation |
| Evidence | queue scores, motion, walk.json | k full trajectories of this task side by side |
| Probe before adopt | no | yes |
| Judge | human (veto issue, settle), verify gate | LLM composer + blind selector; outcome never fed back |
| Guard against bad adoption | 3-day veto window, weekly cap, floor 6.0, `KEEP`-equivalent is the default (nothing promotes unless aged) | validation + one retry; no rollback |
| Known failure | drift from wrong brief; silting (now valved) | selector picked 55-pt over 95-pt; library pollution |

**What Harness² has that upstream lacks:** probe-before-adopt, formal surface, blind selection, per-edit verdicts with `confounded`, audit cache. **What Nexus has that Harness² lacks:** a human veto in the adoption path, a meta-rail, a GUI to read the edits, cost governors. **What neither has and MMD does:** an outcome ledger that measures the judges (`docs/reports/eval/` in MMD). A Harness²-style refiner without that ledger would adopt skill edits on LLM opinion, which is the failure Harness²'s own paper documents.

The slot is already named: spec 59 "Improve: off|gentle|steady|bold … bold — nexus itself" (`plan/59-improvement-dial.md:28-60`), 0 of 5 chunks built.

### 3.3 Harness² ∩ Agensh — still almost nothing

Both research drops, both prompts-as-logic, both gate-less. Complementary gaps unchanged.

---

## 4. Strengths and weaknesses, and how each helps the other

### Nexus upstream
**Strengths:** complete stack with a real GUI; claims that cannot double-win; mid-turn steering through a native hook; cloud governors that spend nothing to decide not to run; silt valve with human veto; footgun ladder enforced in code; secrets never in model reach by construction; park/resume durability; 159 test files; Windows-aware.
**Weaknesses:** parallelism is attended-only by doctrine; shared findings are free text; no probe-before-adopt for skill edits; no eval ledger (upstream); PR gate is conventional (no judge/adversarial review); permission drift (D4 bypass, D7 read-outside guard dropped in auto); spec 59 unbuilt so the anti-lull knobs are not yet coherent; token scope still blocks cloud edits to workflows.
**Gets from Agensh:** typed board; per-turn nudge; unattended fleet.
**Gets from Harness²:** probe→compose→blind-select for skill edits; formal surface; confounded verdicts; audit cache.
**Gets from MMD:** eval ledger; partitioned review; telemetry shards.

### Harness²
**Strengths:** config-as-search-object; evidence-as-filesystem; INV/DOM contrast; blind selection; fingerprinted resume; grader-leak tripwires; honest ablations.
**Weaknesses:** no outcome gate, no human gate, no rollback, fixed budget, permission bypass, Vertex/Linux/bun packaging, benchmark-coupled.
**Gets from Nexus:** the veto window as adoption gate; quota governor; GUI to read `decisions/`; meta-rail. **Gets from MMD:** the judge job as outcome feedback. **Gets from Agensh:** a board so parallel candidates see each other's `FAIL`s.

### Agensh
**Strengths:** the board; MCP result shim; durable event state machine; sealed archives; egress proxy; honest REPRODUCE.md.
**Weaknesses:** no tests; no merge gate; no cost accounting; one pinned model; no cross-run memory; Python-centric dedup on C/Haskell; regex `[status=verified]` gameable; health check lies when model is stuck; 26 containers for 8 workers; single-run results; no limitations section.
**Gets from Nexus:** CAS claims; PR gate; footgun ladder as its missing memory; quota governor; park/resume. **Gets from Harness²:** per-domain library; `confounded` instead of regex verified.

---

## 5. Graft candidates (revised; each flag-removable; seams are upstream files)

Items from revision 1 that upstream already covers are struck and noted. Ordered by value ÷ risk.

| # | Graft | From | Nexus seam | Flag | Status vs rev 1 |
|---|---|---|---|---|---|
| G1 | **Typed board**: `OBSERVED/FACT/FAIL/CLAIM/PATCH_SUMMARY` gists, 100/300-char caps, dedup `(xN)`, `PATCH_SUMMARY` replace-by-chunk-id, `FAIL` invalidates, unread cursor per session, grep. Store as a second file on the existing `claims` orphan branch (same CAS path) or D1 | Agensh `shared_lessons.py`, `main.py` `/snapshot` | `scripts/claims.mjs` codec pattern; `scripts/announce.mjs` becomes the typed writer; GUI Plan board reads it | `NEXUS_BOARD=typed\|plain` | **Narrowed**: claims and notice board exist; only typing, dedup and cursors are new |
| G2 | ~~Mid-turn injection~~ → **Widen `steer.mjs`** to also hand over board `FAIL`s touching the session's claimed chunk and colliding claims, not only owner lines | Agensh `/pending` leases | `templates/claude/hooks/steer.mjs` (already PreToolUse + UserPromptSubmit) | `NEXUS_STEER_BOARD=on\|off` | **Mostly done upstream**; small extension |
| G3 | **Unattended fleet**: cloud `march.yml` matrix of N contributor-mode `/next` lanes, each claims via CAS, builds in its worktree, lands a PR; owner settle remains the single writer to plan files; PR cap = N | Agensh worker model; Nexus `customization/sessions.md` fleet made unattended | `march.yml` `concurrency`; `scripts/owner.mjs` contributor mode; `pr-flow.yml`; `concepts/loop-shapes.md:172-175` doctrine rewritten | `NEXUS_LANES=1..N` | **Smaller than rev 1**: plumbing exists; the graft is doctrine + a matrix. Requires G6 first if lanes land unattended |
| G4 | **`/refine {verb}`** under spec 59 `Improve: bold`: propose k edits (INV: procedure; DOM: footguns) citing ledger/walk evidence; **probe** by replaying the verb on the last 3 chunks' inputs in a worktree; compose; **blind-select** on gate outcomes only; `KEEP_BASE` default; one footgun/decision row as the EXPERIENCE | Harness² `recursion.py`, `selection.py`, `prompts.py` | `plan/59-improvement-dial.md`; `skills/digest.md` night; `identity/footguns.md`; retro step | `Improve: bold` line in bearings (exists as a knob, unbuilt) | Unchanged in idea; now has a named slot |
| G5 | **Formal editable surface** `surface.json`: allow skills/*.md procedure sections, `identity/footguns.md`, lane blocks; forbid `guard.mjs`, `steer.mjs`, `settings.json`, `.github/workflows`, bearings locked tables; char caps; `verify.mjs` leg. Note: because nexus runs on itself, ordinary chunks already edit `skills/`; the surface must distinguish a briefed chunk (allowed) from an unbriefed refinement (surface-bound) | Harness² `SurfaceSpec`, `tree.validate` | `scripts/verify.mjs`; makes the proposals-never-actions rail (`concepts/loop-shapes.md:146-160`) mechanical | `NEXUS_SURFACE=enforce\|warn` | Unchanged; prerequisite for G4 |
| G6 | **Outcome judge** for G3 and G4: port MMD's eval ledger (escape ledger, parent replay "could the test fail", acceptance-ID proof check) into the kit as `scripts/eval/*` + a `judge` job in `pr-flow.yml`; a refinement or an unattended lane's PR is accepted only if ≥ base | **MMD** `docs/reports/eval/`, `scripts/pr-judge.mjs`, `scripts/pr-acceptance.mjs` | `.github/workflows/pr-flow.yml`; spec 39 "PR cloud loop proven" | `NEXUS_JUDGE=on\|off` | **New**: rev 1 assumed upstream had this. It does not |
| G7 | ~~Egress proxy~~ | Agensh | — | — | **Dropped for upstream**: names-only vault + SSE mask + `secrets scan` gate already hold the line. Keep as an MMD-only fix for the 2026-10-21 log leak |
| G8 | **Per-turn nudge**: Stop hook warns when a shipping verb ended with no pending file, no claim release, no retro row | Agensh `dispatcher.ts:402-418` | `templates/claude/hooks/guard.mjs` stop | existing strict-stop | Unchanged, small |
| G9 | **Evidence-as-filesystem for builder/reader sub-agents**: `/next` writes `context/{chunk}/` (spec excerpt, acceptance IDs, walk rows, prior FAILs) and hands a 20-line MISSION instead of an inline brief | Harness² `core/context.py` | `skills/next/build.md`; later MMD's `pr-partition.mjs` if ported | `NEXUS_CONTEXT=tree\|inline` | Unchanged |
| G10 | **Content-addressed audit** of every sub-agent/editor call (mission, response, workspace) | Harness² `proposer.py` `_write_audit` | `.nexus/cache/` already caches Haiku helpers; extend | `NEXUS_AUDIT=full\|rows` | Unchanged; makes G4 replays free |
| G11 | **GUI panels**: (a) Board tab on `/board` showing typed gists per chunk and `FAIL`s; (b) Refinement view on `/s/{id}` cockpit showing `decisions/` diffs from G4 with Keep/Veto buttons routed to the Oversight inbox; (c) Fleet tiles for unattended cloud lanes | Nexus own GUI | `packages/cli/src/screens/{Board,Cockpit,Inbox}`; `server/plan.mjs` passthrough pattern; Claude Design handoff boards | follows G1/G3/G4 | **Rewritten**: extends the existing GUI instead of inventing one |
| G12 | **Partitioned adversarial review** ported from MMD into `pr-flow.yml` as the review arm of G6 | **MMD** `skills/review.md`, `scripts/pr-partition.mjs` | `pr-flow.yml`; `.claude/agents/` | `NEXUS_REVIEW=partition\|single\|off` | **New** |

**Not recommended:** Agensh's Mattermost/Gitea/MySQL stack; Harness²'s adapters, Vertex plumbing, fixed 4k/3k budget; Agensh's regex `verified`; any import of either donor's permission posture.

---

## 6. How to know it worked (not you, not me)

1. **Benchmark**: two real chunks from a v2 repo (upstream's own plan is the only v2 repo today; MMD is v1). Pick one closed S chunk with its PR and one AUDIT finding with a known fix. Record cost (`total_cost_usd` from `nexus run`, Actions minutes) and outcome for Nexus-today.
2. **Kill criteria**:
   - G1/G2: two concurrent `/heads-down` sessions on one spec produce zero duplicate `FACT`s on the board (dedup works) and a `FAIL` written by one is in the other's next tool boundary within one turn. Any AUDIT/CRITIQUE merge conflict between them means the board is not carrying the load.
   - G3 + G6: `NEXUS_LANES=2` unattended for one week ships ≥1.5× the chunks of `NEXUS_LANES=1` at ≤1.3× cost, with zero PRs merged whose acceptance IDs lack a named proof (the judge's job). One escape kills it.
   - G4 + G5: `/refine ship-a-chunk` returns `KEEP_BASE` on at least half of runs; any adopted edit does not lower the judge pass rate over the next 10 PRs; `verify.mjs` surface leg rejects an edit to `guard.mjs`, `steer.mjs` or a workflow 100% of the time.
   - G11: `npm run walk` shows the new panels with zero console errors and zero `noAlt` rows at both viewports, and the loop's own dimension H files no HIGH against them.
3. **Removability**: flip each flag off; `/march` ticks, `verify.mjs`, kit tests and the 103 CLI tests pass unchanged.
4. **External check**: the judge ledger (G6) is written by a job with no token in reach and not by the thing being judged. Use it, plus `probe.yml` latency and the motion pulse, not the loop's narration.

---

## 7. Risks specific to this merge

- **Order is forced.** G6 (judge) before G3 (unattended lanes) and before G4 (refine). Unattended PRs through a conventional `pr-flow.yml` repeat Agensh's self-merge problem in slow motion. A refiner without an outcome judge repeats Harness²'s 55-vs-95 failure.
- **Doctrine debt.** `concepts/loop-shapes.md` must be rewritten, not ignored, or `/critique` will file the swarm as a violation every pass.
- **Permission posture.** D4 already lets the GUI start `bypassPermissions` sessions. Unattended lanes must run under the deny walls and `guard.mjs self-test` gains a case per new hook. Do not inherit either donor's posture.
- **Quota.** The governor pauses *every* loop on one subscription for up to a week. N lanes share one `seven_day`. Width must be a function of remaining quota, not a constant. Upstream's own data: 36% of ticks were paid no-ops before the governor landed.
- **Tiering regressed upstream.** CI pins Sonnet 5 everywhere with no effort flag. MMD's Opus/Sonnet/Haiku-per-workflow tiering is a fourth-donor item worth porting with G6, since reviewers and refiners want different tiers from the dispatcher.
- **Lineage.** MMD stays v1 until `upgrade --write` exists (spec 58, 3/13). Grafts land in upstream; MMD benefits only after the upgrade path ships.
- **Human bottleneck is now valved, not solved.** Aged promotion with veto moves candidates without T. Blind selection (G4) could pre-rank `CANDIDATES.md` for the Oversight inbox, but settle stays owner-only.

---

## 8. Suggested next step

ADRs in The Estate, one per group, each with its §6 kill criterion: (a) **Judge + review into the kit** [G6, G12] first, because everything unattended depends on it; (b) **Typed board + steer widening + nudge** [G1, G2, G8]; (c) **Unattended fleet** [G3] with the doctrine rewrite; (d) **Surface + refine + audit** [G5, G4, G10] under spec 59; (e) **GUI panels** [G11] alongside (b) and (d); (f) context trees [G9] when (d) lands.
