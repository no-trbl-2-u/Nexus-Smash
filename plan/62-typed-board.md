# 62 — The typed board

> Sessions working one spec share findings through a typed,
> capped, deduplicated board with an unread cursor per
> reader; a `FAIL` on a file a session is editing reaches it
> at its next tool boundary; and a shipping verb that ends
> with nothing published is told so.

## Why

Across sessions the kit coordinates with claims
(`scripts/claims.mjs`: a compare-and-swap commit on the
`claims` orphan branch, 24 h TTL) and a free-text notice board
(`scripts/announce.mjs`, `.announcements.md`). Claims say who
holds a chunk. Nothing says what a session learned: a failing
command, a fact about a file, a patch summary. Two sessions on
one spec rediscover the same dead end, and the only durable
place for findings is `plan/AUDIT.md` and `plan/CRITIQUE.md`,
append-only files that conflict on every parallel merge (a
mature adopter sharded its telemetry file for that reason;
its queue files still conflict).

The steer hook (`templates/claude/hooks/steer.mjs`) already
hands an owner's line to a running session at its next tool
boundary through a `PreToolUse` deny. It carries only owner
lines.

A research harness for swarms of coding agents (MIT, 2026-10)
shows the shape that works: five gist types with character
caps, exact-then-semantic dedup rendered as a count, a patch
summary replaced by its author's next one and invalidated by
a later failure, an unread cursor per reader so each turn
sees only what is new, and grep over the full history. Its
weakness was that nothing enforced the claims; ours are
enforced already.

## Design

- **The board file.** `board.json` beside `claims.json` on
  the `claims` branch, written by the same compare-and-swap
  path (`scripts/claims-codec.mjs` gains a board codec).
  Append-only entries:
  `{ id, type, chunk, by, session, at, text, detail?,
  replaces?, invalidates? }`.
- **Five types, two caps.** `OBSERVED`, `FACT`, `FAIL`,
  `CLAIM` (mirrors `claims.json`, read-only here) and
  `PATCH` (a patch summary). `text` is 100 characters;
  `PATCH` 300; `detail` is unbounded and shown only on
  `unfold <id>`.
- **Dedup.** Exact normalized text, then a key of file path +
  symbol + error class + test name, language-neutral (no
  Python-only regexes). A duplicate bumps a count rendered as
  `(x3)`. A `PATCH` with the same `chunk` by the same session
  replaces the earlier one; a `FAIL` naming that chunk marks
  the latest `PATCH` `invalidated`.
- **Reading.** `node scripts/board.mjs snapshot` prints
  entries newer than this session's cursor, newest `FAIL`
  first, then advances the cursor (`.nexus/board-cursor.json`,
  untracked). `read --all`, `grep <expr>` with `&`, `|` and
  parentheses, `unfold <id>`.
- **Writing from skills.** `skills/next/build.md` writes a
  `FAIL` when a gate or test fails with the command and the
  first error line; a `FACT` for a decision made upfront; a
  `PATCH` at land. `skills/next.md` Step 0 reads the snapshot
  for the spec it is about to pick.
- **Mid-turn delivery.** `steer.mjs` also drains board
  entries addressed to this session: a `FAIL` whose file set
  intersects the session's claimed chunk, and a `CLAIM`
  collision. Same deny-with-reason path, same once-only
  marker, same `NEXUS_NO_STEER` off switch. Board lines are
  data in the reason, never instructions (spec 54's rule).
- **Published nothing.** `guard.mjs` `stop` warns when a
  shipping verb (`next`, `ship-a-chunk`, `iterate`) ends with
  no pending file, no `PATCH` and no claim release this
  session. Under `NEXUS_STRICT_STOP` it blocks once with the
  reason; the loop never wedges (the existing three-strikes
  rule).
- **Retention.** `tidy` prunes entries older than 30 days
  whose chunk has left the plan; `FAIL`s on open chunks stay.
  The board is runtime state, never the plan: nothing in it
  is read by plan-check.
- **Templates.** `board.mjs`, the codec change, the steer and
  guard changes ship as template twins; `customization/
  board.md` documents it beside `claims.md`.

## Contracts

- `board.json` on the `claims` branch; entry fields above.
- `node scripts/board.mjs note <TYPE> <chunk> "<text>"
  [--detail <file>]`, `snapshot`, `read --all`, `grep
  <expr>`, `unfold <id>`, `prune`.
- `.nexus/board-cursor.json` per session, untracked.
- Allowlist line `Bash(node scripts/board.mjs:*)` in
  `templates/claude/settings.json`.

## Acceptance

- **A1** Two sessions writing the same `FACT` produce one entry with `(x2)`; a `PATCH` is replaced by its author's next for the same chunk; a `FAIL` naming the chunk marks it `invalidated`; caps are enforced; a lost compare-and-swap race retries and never drops an entry.
- **A2** `snapshot` prints only entries newer than the caller's cursor, `FAIL` first, and advances the cursor; `grep` honours `&`, `|` and parentheses; `unfold` prints the detail.
- **A3** `/next` reads the spec's snapshot in Step 0 and the builder writes a `FAIL` on a red gate and a `PATCH` at land, each visible to a second session's next snapshot.
- **A4** A `FAIL` touching a file in a session's claimed chunk is handed to that session at its next tool boundary once, with `NEXUS_NO_STEER=1` turning it off; a subagent never takes it.
- **A5** A shipping verb that ends with no pending file, `PATCH` or release gets the stop warning; under strict stop it blocks once and then allows.
- **A6** Template twins, the settings allowlist line, `customization/board.md` and the README tree entry exist; the `upgrade` leg lists the scripts.

## Open questions

(None.)

## Chunks
Measure: 6 open · 0 closed · next A7

- [ ] **62.1** Board codec, compare-and-swap write, dedup and caps · M · closes A1 · needs 60.1
- [ ] **62.2** `snapshot`, cursors, `grep`, `unfold` · S · closes A2 · needs 62.1
- [ ] **62.3** `/next` and the builder read and write the board · M · closes A3 · needs 62.2
- [ ] **62.4** Steer carries board failures and claim collisions · S · closes A4 · needs 62.2
- [ ] **62.5** The published-nothing stop warning · S · closes A5 · needs 62.3
- [ ] **62.6** Templates, allowlist, docs · S · closes A6 · needs 62.4, 62.5
