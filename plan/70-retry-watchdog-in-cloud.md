# 70 — Unattended runs wait out transient rate limits

> The cloud workflows arm Claude Code's retry watchdog, capped
> under each job's timeout, so a transient 429 or 529 is waited
> out instead of failing the tick and raising the crash alarm.

---

## Why

Claude Code's changelog names `CLAUDE_CODE_RETRY_WATCHDOG` as
the retry mechanism for unattended sessions, and v2.1.295 added
`CLAUDE_CODE_RETRY_WATCHDOG_MAX_WAIT_MS` to cap its wait.
Neither appears in `.github/workflows/` or the templates. Two
429 `rate_limit` crashes on 2026-09-21 (runs 35525362773,
35540854118) each ended the tick outright. Promoted from
CANDIDATES (score 6.5, proposed 2026-10-09) by `/oversight` on
2026-10-26.

## Design

- Confirm the flag's real value semantics first (boolean or a
  token); the changelog does not say.
- Add both env vars to every cloud workflow that runs Claude
  (`march.yml`, `night.yml`, and any other), with the max wait
  set well under each job's `timeout-minutes`, and mirror them
  in `templates/.github/workflows/`.
- A short note in `.github/CLOUD_LOOP.md` and
  `playbooks/cloud-loop.md` on the two vars and why the wait is
  capped.
- Touches `.github/workflows/*.yml`, so it ships from a local
  session, not a cloud tick.

## Acceptance

- **A1** Every cloud workflow that runs Claude, and its
  template twin, sets the watchdog with a max wait under the
  job timeout, and the cloud-loop docs say why.

## Open questions

(None.)

## Chunks
Measure: 1 open · 0 closed · next A2

Not chunked yet.
