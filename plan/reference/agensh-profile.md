# Agensh (microsoft/Agensh) — source-cited capability profile

Generated 2026-10-25 from repo at commit 0468a3e "Initial release of Agensh" (2026-10-21, 109 files, ~11.1k lines), arXiv 2609.26781 v1 (2026-09-22), and agens-harness.github.io. Paths relative to `Harness-Mash/agensh`.

## Framing

Agensh is **not an agent loop**. The per-agent loop is GitHub Copilot CLI 1.0.70 in ACP mode (`agent/Dockerfile:35-44`, `agent/entrypoint.sh:186-196`). Agensh is the *organization layer* around it: a per-worker event router, a shared "board" service, Gitea + Mattermost as infrastructure, and prompts. Paper §2.3 says so explicitly.

## 1. Main loop

- Team entry: `scripts/launch_single_node.sh` → `scripts/pbench_chain.sh` → `scripts/pbench_run.sh:main()` (seed repo, `make up`, stagger-start workers, DM kickoff, sleep budget, export, quiesce) (`pbench_run.sh:550-692`)
- Per-worker entry: container `ENTRYPOINT entrypoint.sh` renders creds/prompt/MCP config, runs `acp-bridge.py` which spawns `copilot --acp --stdio --no-ask-user --disable-builtin-mcps` as UID 10000 (`agent/entrypoint.sh:186-221`, `agent/acp-bridge.py:70-85`)
- Unit of work: a **turn** = one ACP `session/prompt` whose text is `[shared-context prefix] + [batch of ≤32 queued events]`. Event-driven: nothing happens unless a Gitea notification, Mattermost post, kickoff DM, idle nudge, or reminder arrives (`mini-router/src/dispatcher.ts:302-325, 376-399`; `acp_socket_channel.ts:367-386`; `uem_render.ts:275-288`)
- Cognitive loop (prompted, not coded): run reference → `CLAIM` on board → implement on `main` → compare vs reference → push/PR/merge → `PATCH_SUMMARY` → repeat. Mid-turn: `FAIL`=stop, `FACT/OBSERVED`=use, colliding `CLAIM`=settle by DM (`prompts/agents.txt:61-79`; paper §2.1)
- Run start: seed cleanroom into Gitea `main`, open issue #1, create private channel, DM each worker a kickoff with 30s stagger for first 120 workers then 3s. Budget clock starts *before* the ramp (`pbench_run.sh:388-490`)
- Run end: **pure wall clock**. `sleep "$secs"` then export Gitea HEAD, `docker stop -t 600`, `make down`, run ProgramBench eval. No success/convergence stop (`pbench_run.sh:628-640`)
- Nudges: T-45m and T-5m channel reminders; idle watchdog DMs after 600s without session-state mtime change if queue empty; post-turn "forced-write nudge" if the worker published no gist (`pbench_run.sh:352-372, 493-548`; `dispatcher.ts:402-418`; `board_client.ts:131-148`)
- Single-agent baseline: `scripts/acp_driver.py` re-prompts `resume.txt` after every `end_turn` while >60s remain (`acp_driver.py:237-262, 362-391`)

## 2. State and persistence

- **MySQL `events`**: per-worker durable queue `dedup_key, source, agent, payload JSON, state ENUM(pending/sending/sent/failed/retrying), attempts, batch_id, next_retry_at`; unique `(dedup_key, agent)` (`mini-router/sql/01-events-schema.sql`; `state.ts:39-72`)
- `cursors`: Gitea notification watermark per (agent, source). Mattermost cursor process-local only (`state.ts:282-297`; `listeners/mattermost/listener.ts:217, 307`)
- `agent_kv`: ACP session id so a router restart calls `loadSession` instead of starting fresh (`state.ts:65-71`; `main.ts:102-105`; `acp_socket_channel.ts:584-608`)
- **`board_gists`** (board-service): append-only `board_id, thread_id(agent), type, content, ts_epoch, expires_at, delegation_id, detail LONGTEXT`. Never deleted; in-memory recent view (≤2000) rebuilt by replay at startup (`sql/03-board-schema.sql`; `board-service/main.py:98-134, 172-193`)
- `shown`, `pending_leases`, `board_cursor`: ledger of notices injected mid-turn; 30s lease so two MCP shims for one worker don't double-drain; per-(agent, board) read cursor (`main.py:196-221, 248-296`)
- Copilot native session: SQLite + `session-state/*.jsonl` under persistent HOME bind mount per worker (`entrypoint.sh:54-75, 133-147`)
- Shared workspace: Gitea `main` (SQLite-backed Gitea 1.22.6); PR merge by `coders` team with 0 approvals, direct push admin-only (`docker/bootstrap/bootstrap.sh:266-301`)
- **Between runs: nothing** is carried over. `pbench_run.sh` dies if `$PROFILE_DATA_DIR` exists; shutdown archives are recovery artifacts only (`pbench_run.sh:72-75`; `agent/archive.py:277-299`)

**What board-service is**: FastAPI/aiomysql HTTP service (`board-service/main.py`, port 8660) exposing `/board/{id}/note|read|read_all|grep|unfold|lifecycle`, `/snapshot`, `/pending/{agent}`, `/shown/{agent}`. The "shared context" from DeLM adapted to five typed gists with caps (100 chars; 300 for `PATCH_SUMMARY`), 1h `CLAIM` TTL, deterministic text verification, conservative dedup.

## 3. Learning / memory

- **Within a run**: the board *is* the memory. `FACT/OBSERVED/FAIL` deduped (exact-normalized, then a "semantic key" of file+symbol/line/error/test anchors) rendered with `(xN)` counts; `PATCH_SUMMARY` with same `delegation_id` **replaces** the earlier one; a `FAIL` with same `delegation_id` marks the latest patch `invalidated`; evidence matching `pass(ed)|verified|confirmed|now returns…` gets `[status=verified]`. `board_grep` boolean search over full history; `board_unfold` expands `G{id}` labels (`shared_lessons.py:92-145, 157-166, 239-342`; `verifier.py:497-538`; `gquery.py`; `unfold.py`)
- Unread-only delivery: `/snapshot` advances the viewer's cursor; `/pending` pushes new peer gists and DMs *mid-turn* appended to the next MCP tool result (`main.py:341-410, 652-684`; `mini-router/mcp-notice-shim.cjs:225-252`)
- **Across runs: not present.** No skill library, no prompt evolution, no reuse of prior boards.

## 4. Multi-agent / swarming

- Roles: **none by design**, "N coders, all equal". Identical prompt except `${AGENT_NAME}`. Specialization is *emergent*, reported qualitatively in paper §3.2 (`prompts/agents.txt:35-41`)
- Spawning: **static**. `tools/gen-compose-prod.py` emits one `agent-workerN` + `mini-router-workerN` pair per worker. Agents cannot spawn agents (`--excluded-tools=task --excluded-tools=list_agents`) (`gen-compose-prod.py:318-384`; `entrypoint.sh:187`)
- Message format in: Unified Event Message `{event_id, source, target_agent, kind, summary, observed_at, raw}` rendered as `[event] … summary:`; batches as `[event-batch] N events` (`uem.ts`; `uem_render.ts`)
- Channels: Gitea notifications (SSE wakeup → REST fetch) and Mattermost (WebSocket + 10-min REST catch-up). DMs are "urgent" (mid-turn via MCP shim); channel posts wait for turn end; backlogs >32 group msgs spill to a JSONL file (`listeners/gitea/*.ts`; `listeners/mattermost/*.ts`; `group_messages.ts:193-236`)
- Work split / claiming: **advisory only**. `CLAIM` gist (100 chars, 1h TTL). No lock, no enforcement, no assignment; collisions settled by DM per prompt (`shared_lessons.py:77-79, 147-154`)
- Merging: git PRs on Gitea; agents self-merge (0 approvals). CI (act_runner) exists but merge gate disabled (`bootstrap.sh:272-291`; `agents.txt:76-77`)
- Dedup: events unique `(dedup_key, agent)`; board per §3; code-level dedup none beyond prompt
- **What mini-router does**: one TS sidecar per worker. Fetch tokens from secret-service, ensure schema, recover `sending→pending`, run listeners → MySQL, `Dispatcher.runForever` (30s poll or wake), retry sweeper, `/healthz`. Builds turn prefix via `/snapshot`, prompts over ACP Unix socket, marks batch sent, fires forced-write nudge (`main.ts:80-224`; `dispatcher.ts`; `board_client.ts`)
- Scale: 1,024 agents = 16 nodes × 64; **released code is single-node only** (`PBENCH_ORCHESTRATOR=compose` enforced) (paper p.13; `pbench_run.sh:46`)

## 5. Human oversight

Not present during a run. Prompts forbid asking humans (`pbench-brief.txt:15-16`); Copilot runs `--no-ask-user`; ACP `requestPermission` auto-answered `allow_once` (`acp_socket_channel.ts:619-636`; `acp_driver.py:190-201`). Pre-run gates only: `launch_single_node.sh` preflight (`PREFLIGHT_ONLY=1`). Post hoc: Gitea/Mattermost web UIs via `nginx-edge`, logs, archives. Admin "chairman" account is scripted, not interactive.

## 6. Cost controls

- **Time budget only**: `HOURS` wall clock (default 6h). No token/dollar accounting anywhere (`pbench_run.sh:19-28, 619-631`)
- Context: `COPILOT_PROVIDER_MAX_PROMPT_TOKENS=272000`; tool outputs >1 MiB offloaded (`pbench_gen_env.sh:121`; `entrypoint.sh:158`)
- **Model tiering/routing: not present.** One model, hard-pinned `gpt-5.6-sol`, effort `high`, Responses API; single-agent launcher refuses anything else (`launch_single_agent.py:49`; `pbench_gen_env.sh:109-121`)
- Prompt-size controls doubling as cost controls: gist caps, ≤2000-entry board, unread-only snapshot, 32-event batch cap, 200-char channel summaries
- Memory: 64 GiB/worker, 8 GiB/router, host `pbench.slice` at 80% RAM

## 7. Observability / UI

- Logs to stderr/driver logs; router logs every ACP RX chunk at info (`acp_socket_channel.ts:525`)
- Health: router `/healthz` (SSE only), board `/healthz`, secret-service `/healthz`, Compose healthchecks
- Artifacts: per-worker `shutdown/{boot}/state.tar.gz` + `manifest.json`; `board-lifecycle/{board}.jsonl`; `provenance.json`/`status.json`/`preflight.json` (`archive.py`; `pbench_run.sh:127-146`)
- UI: **none in repo**. `demo/` holds a GIF, two PNGs, a README pointing to the hosted replay. Replay generator not released. Operators observe via Gitea and Mattermost web UIs.
- Traces/dashboards/metrics: not present.

## 8. Extensibility

- Tools: stdio MCP servers listed in `agent/config/mcp.json.tmpl` (gitea-mcp, mcp-server-mattermost 0.5.1, `board-service/mcp.cjs`), each wrapped by `mcp-notice-shim.cjs`. Deny-list in `copilot-deny-tools.json`. Adding a tool = add a server to the template + env plumbing in `gen-compose-prod.py`
- Tasks: **ProgramBench-only**. `TASK_TABLE` of 20 task ids (`pbench_gen_env.sh:21-28`). A new domain means rewriting `pbench_run.sh` seeding/export/eval and the briefs
- Models/providers: Copilot alt-provider `COPILOT_PROVIDER_TYPE=openai` only (`entrypoint.sh:151-155` fatals otherwise); any OpenAI-compatible `/v1/responses` endpoint via `strip_metadata_proxy.py`. **Anthropic not supported** despite `ANTHROPIC_*` variable names (legacy)
- Agent harness: `AGENT_KIND=copilot` only (`entrypoint.sh:14`); paper claims plug-and-play with Claude Code but no adapter shipped
- Prompts: plain templates with `envsubst` allowlist (`scripts/lib_prompts.sh`)

## 9. Failure recovery

- Event delivery: `pending→sending→sent`; failure → backoff `[1s,5s,30s,120s]`, max 5 attempts; retry sweeper 30s; restart recovers `sending→pending` (`state.ts:20-26, 194-269`)
- ACP channel: reconnect backoff `[1,2,5,10,30,60]s`, session restore, silence watchdog `MINI_ROUTER_STUCK_MS` (20 min) force-closes and prepends `[system] previous turn timed out…` (`acp_socket_channel.ts:338, 426-463, 474-616`)
- Bridge: spawns Copilot up to 3×, `session/cancel` on disconnect, SIGTERM/SIGKILL process group; on shutdown seals archive (`acp-bridge.py:73-85, 141-162, 203-214`)
- Model proxy: retries 429/5xx (default 4), never retries timeouts, strips `metadata`/reasoning items (`strip_metadata_proxy.py:69-86, 110-140`)
- Export: 3 attempts then `EXPORT_FAILED` marker; `archive.py check` blocks `make clean` on any incomplete manifest
- Rollback: not present (git history only)
- Sandboxing: Compose network `internal: true`; only `egress-proxy` has egress; workers UID 10000; reference binary root:root 0111 (`docker/docker-compose.pbench.yml`; `pbench_run.sh:190-192`)
- **secret-service**: 98-line stdlib HTTP server handing bootstrap-issued Gitea/Mattermost tokens to routers on `GET /tokens/{agent}` with `X-Internal-Auth`. Why: routers are separate containers and must not mount the whole token directory (`secret-service/main.py`; `gen-compose-prod.py:332-333, 359-363`)

## 10. Dependencies / runtime

- Bash (~1.6k lines), Python 3.11+ (board, secret-service, bridge, archive, proxy, launchers), TypeScript/Node 20 (router), CommonJS Node (MCP board + shim)
- Services per team stack: Gitea 1.22.6, nginx-edge, gitea-admin-init, bootstrap, secret-service, act_runner 0.2.11, MySQL 8.4, Mattermost 10.6, board-service, egress-proxy, plus 2 containers per worker (`gen-compose-prod.py:69-316`)
- Host: Linux, Docker + Compose v2, systemd + cgroup v2, passwordless sudo, `uv`, pinned ProgramBench v1.2.5, per-task cleanroom images, per-task worker image build (cleanroom + Node 22 + Copilot 1.0.70 + MCP binaries)
- Heavy. 8 workers ≈ 26 containers; 64 GiB ceiling/worker. Not Windows/macOS-runnable as released.

## 11. Guaranteed / measured

- **Tests in repo: none.** No unit/integration tests, no CI; only `npm run typecheck`. Zero TODO/FIXME markers.
- Measured (paper §3, README): ProgramBench canonical test-pass rate, 6h, offline, gpt-5.6-sol high, Copilot. Five hardest tasks at 1/8/32/128 agents: 19.31→20.68→26.52→28.78%. Pandoc to 1,024: 33.89→55.06%. GPT-6.1-sol pandoc 56.19→79.59% at 32 agents (README only)
- Reproducibility in code: provenance (image ids, prompt hashes, reference sha256), refusal of reused state, archive checksums, `pbench_score_report.py` warning that CLI raw score can be ~2× canonical (`tools/pbench_score_report.py:121-123`)
- **Not shown**: error bars / multiple seeds; token or dollar cost per configuration; ablations (board vs none, DM vs none, nudges); per-task 1,024 results beyond pandoc; non-monotonic points unexplained (ctags 25.62→18.47 at 8 agents; gromacs flat); comparison to orchestrator-based harnesses at equal cost; model diversity; other benchmarks; replay tooling; multi-node code
- REPRODUCE.md: released stack differs from historical experiment; "a new release run should record its own revision rather than claim exact historical reproduction"

## 12. Failure modes / weaknesses

1. No convergence or quality stop; always consumes full budget; `compile.sh` unverified until eval.
2. Board "verification" is regex on self-reported evidence; `[status=verified]` gamed by writing "passed" (`shared_lessons.py:30-33, 157-166`); claims advisory, expire silently.
3. Semantic dedup keys are Python-centric (`\.py`, `def|class`) while tasks are C/C++/Haskell/PHP (`shared_lessons.py:239-243`); dedup degrades to exact-text.
4. Mid-turn notices only arrive when the agent calls an *infrastructure* MCP tool; pure shell/git work sees nothing until turn end (paper B.2; `mcp-notice-shim.cjs:231`).
5. Mattermost catch-up cursor process-local; reactions/deletions not replayed after reconnect.
6. Idle watchdog depends on `sudo -n` to read 0700 session logs; otherwise never fires (`pbench_run.sh:514`). Liveness = file mtime, not model activity.
7. Router `/healthz` reflects only Gitea SSE; stuck model session reads healthy (`main.ts:189`).
8. `MAX_ATTEMPTS=5` then events silently dropped (`state.ts:207-209`); recovery can redeliver duplicates.
9. Single points of contention: one Gitea on SQLite, one MySQL (≤4 conns/router), MM `MAX_USERS_PER_TEAM=200` hand-raised.
10. Credentials: generated `.env`, rendered Compose and tokens contain secrets; workers get a shared no-auth proxy key, egress proxy injects the real token (`docker-compose.pbench.yml:415-432`).
11. Submitted HEAD vs archives differ in timing (acknowledged confound).
12. Provider lock-in: Copilot + OpenAI Responses only.
13. `SECURITY.md` generic; no threat model for prompt injection via Gitea/Mattermost content fed verbatim into prompts (`uem_render.ts`).
14. Paper has no limitations section; no cost reporting; "emergent roles" claims rest on trajectory reading.

## Architecture in one paragraph

Agensh wraps an unmodified single-agent harness (Copilot CLI in ACP mode, one container per worker, UID 10000, no internet) with three shared services and one sidecar. Gitea is the workspace (PRs to protected `main`, self-merge, no approvals); Mattermost is the message bus (channel = low priority, DM = urgent); the board-service is a MySQL-backed append-only log of five typed ≤100/300-char gists (`OBSERVED/FACT/FAIL/CLAIM/PATCH_SUMMARY`) with claim expiry, patch replacement/invalidation keyed by `delegation_id`, boolean grep over history, and unfoldable details. The per-worker mini-router turns Gitea notifications and Mattermost posts into deduplicated durable MySQL events, batches them into one ACP prompt prefixed with the worker's *unread* board snapshot, retries with backoff, restores the native session across restarts, and nudges if a turn published nothing. An MCP shim around every infrastructure tool appends new DMs and peer gists to tool results so information reaches an agent mid-turn. Host scripts seed the cleanroom, stagger-start workers, DM a kickoff, post reminders, nudge idle workers, and after a fixed wall-clock budget export `main` and run the evaluator. No orchestrator, no roles, no human gates, no token budget, no cross-run memory, no tests; all coordination lives in `prompts/agents.txt`.

## 5 ideas worth borrowing

1. **Typed, capped, append-only shared context with unread cursors.** `board-service/shared_lessons.py` + `main.py:652-684` (`/snapshot`). `FAIL` as the highest-value entry, `CLAIM` with TTL, `PATCH_SUMMARY` replace-by-`delegation_id`, `(xN)` dedup counts, grep-over-history, `G{id}` unfold.
2. **Mid-turn information injection via an MCP result shim.** `mini-router/mcp-notice-shim.cjs` + `/pending`/`shown` leases in `board-service/main.py:262-296, 341-459`. Urgent DMs piggyback on the next tool result; a ledger stops re-delivery (`dispatcher.ts:306-319`).
3. **Durable per-agent event queue with batch state machine and session restore.** `mini-router/src/state.ts` + `acp_socket_channel.ts:584-608`.
4. **"Published nothing this turn" nudge + idle watchdog gated on queue emptiness.** `dispatcher.ts:402-418` / `board_client.ts:131-148`; `pbench_run.sh:493-520`.
5. **Sealed, verified shutdown archives that gate destructive cleanup**, plus the credential-injecting egress proxy so workers never hold the real API key. `agent/archive.py`; `acp-bridge.py:203-214`; `pbench_chain.sh:116-176`; `scripts/strip_metadata_proxy.py`; `docker-compose.pbench.yml:415-432`.
