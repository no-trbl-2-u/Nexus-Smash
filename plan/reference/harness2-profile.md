# Harness² (google-research/harness2) — source-cited capability profile

Generated 2026-10-25 from repo at commit 1cfe254 (2026-10-13), arXiv 2610.14224, harness2.github.io, and the RITS independent overview. Paths relative to `Harness-Mash/harness2`.

## Framing

Harness² is **not an agent runtime**. It is a benchmark-bound harness *optimizer* that edits the file-based configuration (prompts/skills/scripts/plugins) of a third-party coding agent (OpenCode or Codex) and re-runs it. The executor is OpenCode/Codex; Harness² is the outer loop. No task runner, no chat loop, no tool registry.

## 1. Main loop

- Entry: `harness2` console script → `harness2.cli.run_sweep:main` (`pyproject.toml` L27-35)
- Unit of work: (benchmark, task_id). Per task: k reference rollouts of base harness → 2k candidate harnesses proposed+rolled → k compositions rolled → blind selection → reflection → library write → `summary.json` (`harness2/core/schedule.py` `run_task` L566-666)
- Domains run in parallel (ThreadPoolExecutor); tasks within a domain strictly sequential; library threaded forward prefix-only (`schedule.py` L780-850, L669-733)
- Parallel mode: inv1..invk, dom1..domk proposed concurrently, then agg1..aggk compose (`core/recursion.py` L343-449)
- Sequential mode: k rounds, each proposes inv_t/dom_t vs checkpoint c_{t-1}, composes c_t (`recursion.py` L452-566)
- Stop: **fixed budget, no early stop**. `Ledger.assert_identity` requires exactly R=4k rollouts, P=3k improver sessions, else `BudgetError` (`core/ledger.py` L26-33, L89-113)
- Escalation to human: none. Failures degrade (invalid proposal → 1 retry with error fed back → inherit current harness)

## 2. State and persistence — plain files under `runs/`, no DB, no server

- Namespace `{bench}-{substrate}-{mode}{k}[-s{seed}]` (`schedule.py` `ns()` L111-127)
- `config.json` run-identity lock; mismatch on resume is a hard error (`cli/run_sweep.py` L209-235)
- Per-task `summary.json` under flock + atomic replace (`schedule.py` L239-262, L289-328)
- Evidence trees fed to the LLM: `context/{label}/{task.md, source/, rollouts/*.md, deliverables/, harness/, pool/{label}/{harness, harness.diff, rollout.md, produced.md}, library/, decisions/}` (`core/context.py` L15-27, L105-188)
- `.adapt_complete` marker: rollout reused only if harness sha matches (`core/runmark.py` L30-102)
- Improver audit/cache: `_audit/{ns}/{label}.{sha16}.{mission,system,response}.md` + `.workspace/` (`core/proposer.py` L313-388)
- Library: `runs/{bench}/library/.../{mode}/{domain}/{INDEX.md, harnesses/{task}/harness/{tree}, EXPERIENCE.md}` (`core/library.py` L15-23, L215-222)
- Judge cache `judged.json`; `None` ≠ 0, never overwritten by a failed re-judge (`cli/judge.py` L15-30, L55-75)

## 3. Learning mechanism

- Only the **harness tree** is modified (rel_path → text) inside an allow-listed `SurfaceSpec`. No Python, no weights, no Harness² prompts.
- OpenCode surface: `systemprompt.md`, `guardrails.md`, `LongTermMEMORY.md`, `tool_descriptions/tool_guidance.md` (24,000-char cap); on-demand `skills/{n}/SKILL.md`, `sub_agents/{n}/AGENT.md`, `scripts/{n}.py`, `plugin/{n}.ts` (`substrate/opencode.py` L42-88). Codex: `AGENTS.md` (8,000 cap), `.agents/skills`, `.codex/hooks.json` (`substrate/codex.py` L39-106)
- Editor = agentic LLM subprocess (`opencode run` or `claude -p --dangerously-skip-permissions`) in a temp dir with `context/` + `MISSION.md`; edits `context/harness/` in place; harvested back (`proposer.py` L126-311)
- Three roles: INV (how the agent works), DOM (what a practitioner knows), AGG/COMPOSE. Every edit must cite a trajectory moment; `KEEP_BASE` is an accepted answer (`core/prompts.py` L824-890, L893, L964, L333)
- Judged: **no ground truth**. Candidates probed (re-rolled); composer reads trajectories+deliverables+diffs. Selector sees only anonymized deliverables (seeded shuffled ids), never the harness (`core/selection.py` L71-86, L268-357)
- Reflection: diffs every candidate vs base, `{edits}` verdicts {helped, hurt, no observed effect, confounded}, at most one `{experience}{cue, lesson, evidence, confidence}` or `NO_ENTRY`; library write only if all three present (`selection.py` L402-505; `library.py` L43-47, L106-152)
- Library use: copied whole into the next task's `context/library/` (same domain, earlier tasks only); every task restarts from H₀ (`context.py` L160-165; `prompts.py` L295-331)
- Regression prevention, mechanical: `tree.validate` caps, skill frontmatter, scripts must ship, py-compile, hooks schema; adapter `validate_tree`; grader-verdict scan; one retry then inherit (`core/tree.py` L192-213, L336-390; `recursion.py` L108-132, L176-251)
- Regression prevention, semantic: **prompt-only**. No score-based acceptance, no rollback on worse score. Judge never feeds back ("Nothing in the method imports this module", `core/judge.py` L15-18)
- Anti-leak: `leak_globs`, `GRADER_VERDICT_MARKERS` 7-string scan, `BenchPrompts` word filter (`context.py` L399-519; `core/spec.py` L105-127)

## 4. Multi-agent / parallelism

- Roles: solver (`HARNESS2_SOLVER_MODEL`), proposer INV/DOM/composer (`HARNESS2_IMPROVER_MODEL`), selector, reflector, judge offline (`config.py` L108-112, L170-172)
- Message format: **filesystem**. `MISSION.md` + `context/` tree; replies parsed by regex for `{notes}`, `{why}`, `{edits}`, `{experience}`, ```choice (`context.py` L521-546; `proposer.py` L253-311)
- Split: independent INV vs DOM candidates. Merge: LLM composition reading all diffs/rollouts/decisions. No programmatic merge (`recursion.py` L404-434; `context.py` L290-334)
- Knobs: `--workers` (domains), `PHASE_WIDTH=2`, `PROPOSER_CONCURRENCY=2`, judge parallel 8
- Sub-agents only as harness components the editor may write; `allow_subagents` False by default (`spec.py` L143)
- Agent-to-agent bus: not present

## 5. Human oversight

- Approval gates: **not present**. Fully unattended; adoption and library writes automatic.
- Post hoc only: `harness2-judge` then `harness2-report` prints WARNINGs (noise floor at k=1, final chosen <25%, base chosen ≥80%, fallbacks) (`core/report.py` L114-165)
- Pre-spend: `harness2-check` / `require_ready`, `--dry-run` (`preflight.py` L28-60)
- Permissions: executor and improver run with prompts **disabled** (Codex `--dangerously-bypass-approvals-and-sandbox`; Claude `--dangerously-skip-permissions`; OpenCode fenced to cwd) (`codex.py` L157-174; `proposer.py` L214-222)
- Editor `{notes}` stored in `decisions/` for a human to read later

## 6. Cost controls

- Hard structural budget R=4k/P=3k (`ledger.py`)
- No token cap in Harness²; `OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX=64000`; improver steps=120, timeout 3600s
- Rollout timeouts per bench 2400-3600s
- USD accounting summed from OpenCode `step_finish.cost` / Claude `total_cost_usd` into ledger + audit meta
- Content-addressed improver cache + rollout fingerprint reuse → re-runs free
- Model tiering: three slots only (solver/improver/judge). No per-stage routing.

## 7. Observability / UI

- UI/dashboard: **not present**. Site has a JS pipeline-player demo only.
- Logs: `print(flush=True)`; no logging module
- Traces: full improver audit, rendered trajectories in `[ACTION]/[OBSERVATION]/[ERROR]` grammar, per-candidate `harness.diff`, `decisions/*.md`, `selection.json`, `adoption.json`, `summary.json` incl. pairwise line-Jaccard `similarity` to detect candidate collapse (`opencode.py` L334-395; `tree.py` L407-427)
- Metrics: JSON only.

## 8. Extensibility

- Add task source: implement `BenchmarkAdapter` Protocol (tasks, domain_of, task_prompt, task_files, execute, delivered, trajectory, deliverable_text, base_harness, validate_tree, score) + `BenchSpec`. `DemoAdapter` (163 lines) is the reference (`spec.py` L200-250; `demo.py` L41-120)
- Add executor: implement `Substrate` Protocol (surface, materialise, execute, read_trajectory, preflight) + `SurfaceSpec` (`substrate/base.py` L47-80; `tree.py` L40-61)
- Improver channels hard-coded (`"claude_cli"`, `"opencode"`) (`spec.py` L33)
- Providers: not Gemini-only in code but Vertex-centric. Claude CLI forced onto Vertex (`CLAUDE_CODE_USE_VERTEX=1`, Anthropic keys stripped). Codex needs a Responses-API endpoint (bridge = LiteLLM to Vertex). WorkBuddy setup **refuses** unless solver is `google-vertex/gemini` (`config.py` L108-187; `proposer.py` L46-52, L105-124; `docs/BENCHMARKS.md`)

## 9. Failure recovery

- Retries: `TRANSPORT_ATTEMPTS=2`, `STAGE_ATTEMPTS=2` with error fed back, runner `MAX_RETRIES=2`
- Rollback: none (every task restarts H₀; library persists). `library.forget/retain` for resume determinism
- Resume idempotent by run_id + harness fingerprint + output fingerprint; timeouts left unmarked so they re-roll
- Sandboxing **weak**: OpenCode cwd fence only; Codex sandbox disabled; network unrestricted everywhere (docs tell you to firewall yourself). Improver temp dirs isolated via XDG vars.
- Process-group kill on wall timeout

## 10. Dependencies / runtime

- Python 3.12/3.13, **POSIX only** (`fcntl.flock`). Will not run on Windows natively.
- Zero core runtime deps; extras `render`/`bridge`
- Real runs: Node 20+, uv, gcloud ADC, pinned Bun + OpenCode **from source** at fixed SHA, Codex CLI 0.144.6, Pandoc+Poppler (LAB), Docker (WB), Vertex project; three per-bench venvs
- Heavy: k=1 = 4 rollouts + 3 sessions + reflection per task; k=5 = 20 + 15 + selector
- `.env.example` referenced in docs but **missing** from repo

## 11. Guaranteed / measured

Tests (5, demo adapter, no model calls): budget identity, resume reruns nothing, k=1 skips selector, tampered harness forces re-run, leak glob never enters context, library prefix-only, grader tripwire fires, invalid proposal retried once, `NO_ENTRY` → no library write, failed selection never judged. **Protocol/plumbing invariants only, not learning efficacy.**

Paper: WorkBuddy-Bench, JobBench, LAB/Harvey. Executors Gemini 3.5 Flash and GLM-5 on OpenCode/Codex; editor and selector Claude Opus 4.8. 3 runs/config. Gemini/OC WB 72.4→77.5 (k=1)→80.8 (parallel k=5); JB 31.5→36.0; LAB 79.9→81.9. GLM-5/OC WB 64.2→75.7. Ablation: w/o library −3.1/−1.8; w/o INV/DOM −2.9/−3.7; w/o composition −1.6/−1.9. Tool calls **not** reduced.

Not shown: $/token cost per task; CIs beyond SD of 3; non-benchmark deployment; human eval of harness quality; library behaviour beyond ~100 tasks; judge sensitivity. `docs/EXPERIMENTS.md` admits a Codex rollout **downloaded its own rubric** from Hugging Face.

## 12. Failure modes / weaknesses

1. No outcome-based acceptance; judge never feeds back. Paper Fig. 14: 9 regressions incl. selector picking a 55-pt over a 95-pt output.
2. Library pollution risk: full trees after one task; only prompt text guards; no consolidation/retrieval; only 2-10% of modified files kept ≥half their lines from an entry.
3. Rubric leakage defended by string tripwires, not isolation.
4. Permission bypass everywhere, and editor-written scripts/plugins/hooks **run** in the next rollout with only a py-compile check.
5. Fixed budget, no adaptivity; k=1 parallel == sequential so gaps there are noise.
6. Resume fragility: any config change needs a new `RUNS_DIR`.
7. Benchmark-coupled packaging; every real path assumes Vertex, bun-from-source, Linux.
8. POSIX-only; `.env.example` missing; threads not processes.
9. Evidence truncation (`obs_trunc=50,000` chars).
10. Selector fallback silently adopts first sorted final.
11. Paper: SDs up to 4.5 pts; single-rollout probes; effects not additive.
12. Size caps in chars not tokens.

## Architecture in one paragraph

A Python outer loop treating an agent's **config files** as the search object while model and framework stay frozen. A `BenchmarkAdapter` yields tasks by domain; the scheduler rolls k base executions via a `Substrate` (OpenCode/Codex), builds an on-disk evidence tree, and spawns agentic LLM editor sessions under INV and DOM lenses that edit files in `context/harness/`. Trees are validated mechanically, re-rolled, composed; a blind selector picks an anonymized deliverable; a reflector distils verdicts plus one lesson; the adopted tree is appended to a per-domain file library visible only to later tasks. Budget is fixed at 4k+3k per mode; everything is content-fingerprinted for free resume; grading is quarantined offline. No UI, no human gate, no token budget, no outcome rollback.

## 5 ideas worth borrowing

1. **Evidence-as-filesystem, prompt-as-pointer.** `core/context.py` (`build`, `mission`); `proposer.py` (`_opencode`, `_harvest`)
2. **Allow-listed editable surface + mechanical validation + one feedback retry, else inherit.** `core/tree.py` (`validate`, `autotrigger`, `is_allowed`); `recursion.py` (`_run_stage`, `_accept_tree`)
3. **Contrastive INV/DOM propose→probe→compose, `KEEP_BASE` first-class, blind anonymized selection.** `core/prompts.py` (`propose`, `_KEEP_BASE`, `select`); `selection.py` (`assign_ids`, `run_selection`)
4. **Reflection with per-edit verdicts incl. mandatory `confounded`, `NO_ENTRY` allowed; library = full tree + EXPERIENCE.md per domain, prefix-only visibility.** `prompts.py` (`experience`); `selection.py` (`_distil`, `reflect_adoption`); `library.py`
5. **Identity-fingerprinted, resumable, audit-everything bookkeeping.** `runmark.py`; `proposer.py` (`_call_fingerprint`, `_write_audit`); `run_sweep.py` (`_check_identity`); `ledger.py`; `judge.py` (`None` ≠ 0)

Honourable mention: grader-verdict tripwire (`context.py` L419-519; `spec.py` L105-127).
