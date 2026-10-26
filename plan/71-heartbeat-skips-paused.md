# 71 — The heartbeat's cancel step skips a paused workflow

> The heartbeat's "Cancel wedged runs" step skips a watched
> workflow that is not `active`, like its two sibling steps,
> so pausing `march` no longer fails the whole heartbeat job.

---

## Why

On 2026-10-21 two heartbeat runs (39545645949, 39594489838)
failed with `could not find any workflows named march`: the
owner had paused `march` (`disabled_manually`), and
`gh run list --workflow <name>` cannot resolve a non-active
workflow by name. The step runs under `bash -e`, so its failure
ends the job before the two later alarm steps run, and those
already read `gh workflow list --all` and skip a non-active
workflow. The step is unchanged in
`.github/workflows/heartbeat.yml` today. Promoted from
CANDIDATES (score 7.0, proposed 2026-10-21) by `/oversight` on
2026-10-26.

## Design

- Read `gh workflow list --all` once at the top of the cancel
  step and skip `$wf` when its state is not `active`.
- The same change in `templates/.github/workflows/heartbeat.yml`.
- Touches `.github/workflows/*.yml`, so it ships from a local
  session, not a cloud tick.

## Acceptance

- **A1** With a watched workflow disabled, the heartbeat's
  cancel step skips it and the job goes on to its alarm steps,
  in both the kit's and the template's `heartbeat.yml`.

## Open questions

(None.)

## Chunks
Measure: 1 open · 0 closed · next A2

Not chunked yet.
