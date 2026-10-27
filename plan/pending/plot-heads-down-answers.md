---
date: 2026-10-27
---

## Add plan/61-judge-in-the-gate.md
~~~ acceptance
- **A?judgeparse** The judge reads `Closes **A4**` (bold) and `Closes: A1; A2` as closing those IDs, and ignores a closing phrase inside inline code, a code fence or an HTML comment (the ledger's `closedIds` already does).
~~~
~~~ chunks
- [ ] **61.?judgeparse** The judge reads the loop's own closing lines · S · closes A?judgeparse · needs —
  - Owner's call, heads-down end gate 2026-10-27: a small fix now. Port `closedIds` from scripts/eval/ledger.mjs into `closedFromBody` in scripts/pr/acceptance.mjs (both copies).
~~~

## Add plan/58-upgrade.md
~~~ acceptance
- **A?prefixids** A v1 Status row whose id is a letter prefix plus a number (`M3b`, `T6`, `S3`, `P1`, `R2a`) converts: each prefix becomes its own spec and its done rows become that spec's archive lines; a scratch-clone dry run of a real adopter with 256 such rows converts them all.
~~~
~~~ chunks
- [ ] **58.?prefixids** Letter-prefixed v1 phase ids convert, one spec per prefix · M · closes A?prefixids · needs —
  - Owner's call, heads-down end gate 2026-10-27: prefix → its own spec (not one legacy spec, not skip).
~~~

## Notes
- 2026-10-27 heads-down end gate (owner): nexus holds `Improve:` for now (no line, gentle); decide after watching a few ticks, since bold with NEXUS_CADENCE unset picks eager (chaining up to 3, heartbeat 10 h).
- 2026-10-27 heads-down end gate (owner): march.yml and night.yml keep `app-id` on create-github-app-token v3 (a runtime warning only); no switch to `client-id` yet.
