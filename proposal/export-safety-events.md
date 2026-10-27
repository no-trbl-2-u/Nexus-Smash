# Proposal: export Claude Code safety events from CI ticks

Status: draft, approved for the repo by TJ on 2026-10-27; not yet planned as a spec.
Source: Claude Code changelog 2.1.307, "Added the `claude_code.safety_event` OpenTelemetry event for each tool call a permission rule, auto mode, a safety check, a hook or the sandbox stopped, prompted or sent back" (https://code.claude.com/docs/en/changelog). Field list: https://code.claude.com/docs/en/monitoring-usage (read 2026-10-27).

## Problem
Cloud ticks fail quietly when Claude Code refuses a tool call. Today nothing counts those refusals:
- nexus-smash `.github/workflows/march.yml` runs `/march` with `--permission-mode bypassPermissions`. Its comments say whether claude-code-action loads `.claude/hooks/guard.mjs` is unverified (spec 55.6, A4). The only evidence path is the `hook_probe` input writing `$RUNNER_TEMP/hook-probe.log`.
- miserere-mei-deus `.github/workflows/_claude-skill.yml` grants tools with `--allowedTools "<list>"` (default list or the caller's `allowed_tools`). A call outside the list is refused with no prompt and no log line. The tick just does less.
- miserere's `.claude/hooks/telemetry.mjs` logs skills, slash commands and subagents, not refusals.

So "why did that tick no-op" is answered by reading transcripts. A count per tick, per reason, would answer it with a grep.

## What Claude Code now emits (verified against docs, 2026-10-27)
Event `claude_code.safety_event` (needs Claude Code >= 2.1.307), logged when a check refuses a tool call, requires a prompt, or a hook sends a result back. Attributes used here:

| Attribute | Use |
|---|---|
| `category` | `permission_rule`, `managed_policy`, `permission_mode`, `hook`, `auto_mode_block`, `auto_mode_no_verdict`, `safety_check`, `static_analysis`, `sandbox_override`, `user_rejected`, `sandbox_network`, `sandbox_other`, `hook_review`, `other` |
| `decision` | `accept`, `reject`, `sent_back` |
| `reason_code` | e.g. `rule:policySettings`, `mode:dontAsk`, `hook:PreToolUse` |
| `rule_source` | e.g. `projectSettings`, `cliArg` |
| `hook_event` | `pre_tool_use`, and on `hook_review`: `post_tool_use`, `stop`, `subagent_stop` |
| `circuit_breaker` | built-in check, e.g. `dangerousRemoval` |
| `tool_class`, `tool_name`, `tool_source`, `tool_use_id`, `permission_mode` | what was stopped, in which mode |

Important caveat from the docs: a call refused because nobody could answer a prompt with no category produces **no** safety event. It shows only as a `claude_code.tool_decision` event with decision `reject` and `source` `config`. That is the `-p` case with neither `--permission-prompt-tool` nor `--permission-prompts none`. So the sink must keep `tool_decision` rejects too, or miserere's `--allowedTools` refusals stay invisible.

Env vars (verified): `CLAUDE_CODE_ENABLE_TELEMETRY=1`, `OTEL_LOGS_EXPORTER` (`console`, `otlp`, `none`), `OTEL_EXPORTER_OTLP_PROTOCOL` (`grpc`, `http/json`, `http/protobuf`; no default, must be set), `OTEL_EXPORTER_OTLP_ENDPOINT` or `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`, `OTEL_LOGS_EXPORT_INTERVAL` (ms, default 5000), `OTEL_LOG_TOOL_DETAILS` (default off), `OTEL_LOG_USER_PROMPTS` (default off).

## Sink design
No collector, no npm deps (matches the kit's zero-dependency rule).

1. `scripts/cloud/otel-sink.mjs`: a ~60-line Node HTTP server on `127.0.0.1:4318`. Accepts `POST /v1/logs` (OTLP `http/json`), keeps records whose `event.name` is `safety_event`, or `tool_decision` with decision `reject`, and appends one JSON line each to `$RUNNER_TEMP/otel-safety.jsonl`. Drops everything else. Never fails the job.
2. Workflow step before the model step: start the sink in the background, wait for the port.
3. Env on the model step:
   ```
   CLAUDE_CODE_ENABLE_TELEMETRY=1
   OTEL_LOGS_EXPORTER=otlp
   OTEL_EXPORTER_OTLP_PROTOCOL=http/json
   OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=http://127.0.0.1:4318/v1/logs
   OTEL_LOGS_EXPORT_INTERVAL=1000
   ```
   `OTEL_LOG_TOOL_DETAILS` stays unset (see Risks).
4. `scripts/cloud/safety-report.mjs` after the model step (`if: always()`): counts by `category`, `decision`, `reason_code`, `tool_name`; writes a table to `$GITHUB_STEP_SUMMARY`; uploads the JSONL with the walk artifact.
5. miserere only: the same counts become rows in the tick's `telemetry/<date>_<session>.md` shard via `telemetry.mjs` (new event `safety`), next to the `tick-close` rows it already writes from the execution file.

Fallback if step env does not reach Claude: put the same keys in the `env` block of the settings passed to the action, or in a CI-only settings file. Prove which path works in step 1 below before building more.

## File ties
nexus-smash:
- `.github/workflows/march.yml`: sink start step before "Run /march (cloud mode)"; env on that step; report step next to "Hook probe report" and "Lost-to-background check".
- `templates/.github/workflows/` twins of march/night, so adopters get it.
- `scripts/cloud/otel-sink.mjs`, `scripts/cloud/safety-report.mjs` (+ `templates/scripts/cloud/` twins and `__tests__`).
- `plan/55-cadence-that-delivers.md` chunk 55.6 (A4): evidence source, see Side wins.
- `.claude/hooks/guard.mjs`: unchanged; its denies show up as `category: hook`.

miserere-mei-deus:
- `.github/workflows/_claude-skill.yml`: sink step before "Run Claude Code"; env; report after; feeds every caller (march, night, expand, ship-a-phase, pr-review, pr-resolve).
- `.claude/hooks/telemetry.mjs` + `telemetry.test.mjs`: `safety` row type.
- `scripts/telemetry-view.mjs`: show the new rows.

## Side wins
- miserere: tools missing from the `--allowedTools` grant become a counted `tool_decision` reject per tick, so a too-narrow `allowed_tools` (e.g. pr-resolve's `Read,Edit`) shows up instead of a quiet partial tick.
- nexus spec 55.6 A4: if `guard.mjs` denies anything in a cloud tick, a `safety_event` with `category: hook`, `reason_code: hook:PreToolUse` is direct evidence that project hooks load under claude-code-action. Run the `hook_probe` tick with one deliberately denied call (e.g. a `run_in_background` Bash call, which the guard denies when `GITHUB_ACTIONS=true`) to get that event. Absence of the event plus absence of `hook-probe.log` is the "hooks do not load" answer.

## Steps
1. Spike (owner, ~10 min, local): run one `/march` with `CLAUDE_CODE_ENABLE_TELEMETRY=1 OTEL_LOGS_EXPORTER=console`, trigger one denied call, grep `safety_event`. Confirms the event fires on this CLI version.
2. Spike (CI, one dispatch): add the env to march.yml's model step with `OTEL_LOGS_EXPORTER=console` only; check the run log for `safety_event`. Answers whether claude-code-action passes step env to Claude. If not, try the settings `env` block.
3. Build `otel-sink.mjs` + `safety-report.mjs` with tests (fixture OTLP JSON payloads).
4. Wire into nexus march.yml and templates; one dispatched tick.
5. Port to miserere `_claude-skill.yml` + telemetry rows.
6. After 7 days, read the counts (Metrics) and decide what to change.

## Risks
- Data exposure: with `OTEL_LOG_TOOL_DETAILS=1`, events carry Bash commands, tool input and MCP names. Keep it off unless the backend is private. The sink is local to the runner and the artifact is repo-scoped, but nexus-smash's run logs are public, so the step summary must print counts only, never tool input.
- Unverified (confidence 70): whether claude-code-action passes the step's `env` to the Claude process. nexus already found the action drops some JSON settings keys (`permissionMode`, tick 3, march.yml comments). Step 2 settles it.
- Unverified: whether claude-code-action@v1 runs Claude Code >= 2.1.307. The action floats; check the version in the execution file.
- Unverified: flush on exit. Export is batched (default 5000 ms); a fast exit may drop the last events. Mitigation: 1000 ms interval; measure loss by comparing `tool_decision` count with tool calls in the execution file.
- Field drift: the changelog line names the event but not its fields; fields come from the monitoring doc and may change. The report should count unknown `category` values as `other`, not crash.
- Setup cost: a background server step per workflow. Small, but it is one more moving part; it must never fail a tick (exit 0 always, `if: always()` on the report).

## Metrics
- Per tick: safety events by `category` and `decision`; `tool_decision` rejects by `tool_name`.
- Over 7 days: share of no-op ticks that had at least one reject (vs no-op with zero rejects).
- miserere: rejects per caller workflow, to size each `allowed_tools` grant.
- nexus: A4 answered (yes/no) with the event as evidence.
- Decision rule: if rejects explain at least a third of no-op ticks, act on the top reason (widen a grant, fix a guard rule). If they explain almost none, keep the sink only as a cheap alarm.
