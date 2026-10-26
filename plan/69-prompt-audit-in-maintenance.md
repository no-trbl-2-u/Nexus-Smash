# 69 — The first-party prompt audit in the maintenance story

> The kit's maintenance docs name Claude Code's own
> `/doctor prompt-audit` and say when to run it against the
> skills, agents, commands and CLAUDE.md files nexus ships.

---

## Why

Claude Code v2.1.282–283 added `/doctor prompt-audit` (also
`/checkup prompt-audit`), which audits CLAUDE.md files,
skills, agents and commands for stale paths, stale commands,
contradicting instruction files and prompting patterns written
for older models. Those four are exactly the artifact family
nexus ships, and skills drift is the most audited defect class
in `plan/AUDIT.md`. Nothing in the kit names the command.
Promoted from CANDIDATES (score 6.2, proposed 2026-09-28) by
`/oversight` on 2026-10-26.

## Design

- Run the command on this repo first and record what it
  flags; the changelog blurb may not match the real CLI
  surface.
- A short subsection in `customization/claude-code.md`: what
  it checks, and when to run it (before a `/critique` pass,
  and after skills are pruned). The pending `/skill-doctor`
  candidate would land in the same section if it is promoted.
- Findings it raises on this repo go to `plan/AUDIT.md`, not
  into this spec.

## Acceptance

- **A1** `customization/claude-code.md` names `/doctor
  prompt-audit`, what it checks and when to run it, based on a
  recorded run against this repo.

## Open questions

(None.)

## Chunks
Measure: 1 open · 0 closed · next A2

Not chunked yet.
