# 60 — The fork stands on its own

> This repo is a fork of the nexus kit that builds itself with
> its own loop, publishes its own CLI, and can be adopted by a
> fresh repo from a clean start, while still pulling the
> upstream kit forward through one merge path.

## Why

This repo (`no-trbl-2-u/Nexus-Smash`) was forked from upstream
on 2026-10-25. Everything that names the
upstream repo or package still points there (checked
2026-10-25, 38 files):

- `agents.md` "Project" says the kit lives at the upstream
  URL and "Operational secrets" sets `GH_REPO` to the upstream
  repo, so `/triage` and the issue mirror would read a
  stranger's issues.
- `packages/cli/package.json:2` publishes as `@usenexus/cli`,
  an npm scope the fork does not own;
  `.github/workflows/publish.yml` would try it on a `cli-v*`
  tag through Trusted Publishing bound to the upstream repo.
- `packages/cli/server/{plan,server,upgrade,vault-setup}.mjs`
  carry upstream doc URLs that the GUI shows as help links;
  `server/stack-checks-more.mjs:254` names upstream in a
  user agent.
- `.github/workflows/{march,cli-ci}.yml`, `README.md`,
  `playbooks/upgrade.md` and nine specs or notes under
  `plan/` cite upstream paths as the place to clone from.

The upstream kit already runs on itself: `agents.md` "Repo
shape" splits `templates/` (what adopters copy) from `skills/`
and `plan/` (what this repo runs), and
`scripts/upgrade-files.mjs` computes the kit file set so the
CLI's bundled copy and the manual upgrade appendix never
drift. So a fork that builds itself and hands out a clean
start needs no new mechanism, only its own identity and a
sync path.

The comparison that produced this plan is in
[`reference/`](reference/README.md).

## Design

- **One identity file, read everywhere.** `kit.json` at the
  root: `{ "repo": "<owner>/<name>", "upstream":
  "daretodave/nexus", "package": "<scope>/cli", "docs":
  "https://github.com/<owner>/<name>/blob/main" }`.
  `scripts/kit-id.mjs` prints any field; a `kit` leg in
  `scripts/verify.mjs` fails on any committed text that names
  the upstream repo or package outside `kit.json`, `plan/`
  history and this spec. The GUI's `DOCS`, `PLAN_DOCS`, the
  clone hint and the upgrade runbook link read the field at
  build time.
- **The package is ours.** `packages/cli/package.json` name
  becomes the fork's scope; `publish.yml` is disabled until
  the scope exists on npm (a repo variable `NEXUS_PUBLISH`
  must read `1`); the README install line reads
  `npx github:<owner>/<name>` until then. `bin` name stays
  `nexus`.
- **Secrets and the mirror.** `agents.md` "Operational
  secrets" names this repo in `GH_REPO`; `nexus.secrets.json`
  keeps its two names. No new secret.
- **The sync path.** `git remote upstream` stays; a monthly
  `/digest` line reports commits behind upstream; a
  `playbooks/fork-sync.md` runbook says how to merge upstream
  into main (merge, never rebase; conflicts in `plan/` are
  resolved by keeping ours and re-adding upstream chunks as
  pending `## Add` files). Spec 58's `upgrade` dry run already
  proves a kit copy from a fresh origin worktree; the runbook
  points at it for adopters of this fork.
- **A clean start from this fork.** `templates/` stays the
  product. The adopt paste-prompt and the GUI onboarding copy
  from this repo's origin, so an adopter gets this fork's
  skills, scripts and plan shape and none of this repo's own
  `plan/` or `identity/`. The proof is spec 39's scratch
  adopter run against this fork.

## Contracts

- `kit.json` at the root, fields `repo`, `upstream`,
  `package`, `docs`; `node scripts/kit-id.mjs <field>`.
- The verify gate's `kit` leg; its allow-list is the file
  itself, `plan/**`, `identity/**` and this spec.
- Repo variable `NEXUS_PUBLISH` gates `publish.yml`.

## Acceptance

- **A5** A scratch repo adopted from this fork (paste prompt or GUI onboarding) carries this fork's `templates/` files, no file from this repo's `plan/` or `identity/`, and its first `/march` tick runs green.

## Open questions

- **Q1** The fork's npm scope: `@no-trbl-2-u/cli`, or a new name for the merged kit? Until answered, A2 lands with `publish.yml` gated off and the `github:` install line.

## Chunks
Measure: 1 open · 4 closed · next A6

- [ ] **60.5** A scratch adoption from this fork runs green · M · closes A5 · needs —
