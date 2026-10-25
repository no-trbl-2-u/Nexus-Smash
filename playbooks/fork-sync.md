# Playbook: fork sync (merge upstream into this fork)

> This repo is a fork of the nexus kit that runs its own loop
> and its own plan. This runbook pulls the upstream kit's work
> forward through one path: a merge of `upstream/main` into a
> fresh branch cut from `origin/main`, the gate, then landing
> per owner mode. It is for the people who run this fork. A
> repo that adopted this fork upgrades with
> [`upgrade.md`](./upgrade.md) (spec 58's upgrade path), not
> with this page.

---

## The two remotes

- `origin` is this fork (`node scripts/kit-id.mjs repo`).
- `upstream` is the kit it was forked from
  (`node scripts/kit-id.mjs upstream`, read from `kit.json`).

Check once per checkout, and add `upstream` if it is missing.
The address comes from the identity, never typed out:

```bash
git remote -v
git remote add upstream "https://github.com/$(node scripts/kit-id.mjs upstream).git"
```

```powershell
git remote -v
git remote add upstream "https://github.com/$(node scripts/kit-id.mjs upstream).git"
```

The line reads the same in both shells; PowerShell expands
`$(...)` inside a double-quoted string too.

## When to sync

Monthly, or whenever you want upstream's work. A `/digest`
line that reports how many commits this fork is behind
upstream is planned (spec 60's sync path) but not built yet;
until it lands, ask git:

```bash
git fetch upstream
git rev-list --count origin/main..upstream/main
```

Zero means there is nothing to take.

## The merge

Merge, never rebase: a rebase rewrites this fork's published
history, and the merge commit is the record of what came in
and when. Work in a fresh worktree cut from `origin/main`,
never in a checkout that holds other work:

```bash
git fetch origin
git fetch upstream
node scripts/worktree.mjs cut ../nexus-wt/sync-2026-10-25 --ref origin/main --branch sync/2026-10-25
cd ../nexus-wt/sync-2026-10-25
git merge upstream/main
```

Use the day's date in both names. `Already up to date` means
upstream holds nothing this fork lacks; close the worktree
(the last section) and stop.

## Conflicts

Resolve by where the file lives:

- **`plan/`: keep ours.** This repo runs its own plan; an
  upstream roadmap, spec or archive line is not this repo's
  state. `git checkout --ours -- plan/` then `git add plan/`.
  An upstream chunk worth taking comes back as new work: a
  pending file carrying `## Add plan/NN-<topic>.md`, its ids
  written `A?<slug>` and `NN.?<slug>`, so settle numbers it
  past the spec
  ([`../concepts/plan-shape.md`](../concepts/plan-shape.md)
  "Extending a spec from a branch").
- **`identity/`: keep ours.** The footguns and decisions are
  this fork's.
- **`kit.json` and `scripts/kit-refs.json`: keep ours**, then
  run `node scripts/kit-id.mjs refs` and decide (the next
  section).
- **Everywhere else: resolve on the merits.** Read both sides,
  keep what each meant, then re-run the tests that cover the
  file (`npm test` in `packages/cli`, the single verify leg
  that owns it).

Then `git commit` to conclude the merge. The default message
(`Merge remote-tracking branch 'upstream/main' into
sync/<date>`) is fine; add a body line per conflict you
settled by hand.

## The kit leg after a sync

Upstream's new text may name upstream again (its own repo
slug, its npm scope), and the `kit` leg is a ratchet over
`scripts/kit-refs.json`: a file's count may fall, never rise,
and a new file that names upstream is red.
`node scripts/kit-id.mjs refs` prints what names upstream now.
For each rise, lower it before landing: reword the line, or
route it through `kit.json` (`readKit()` in a script,
`node scripts/kit-id.mjs <field>` in a doc's commands). Never
raise a count in `scripts/kit-refs.json` by hand. When counts
only fell, `node scripts/kit-id.mjs refs --write` lowers the
list to match.

## Gate and land

From the sync worktree, foreground, and wait:

```bash
node scripts/verify.mjs
```

Green, then land per owner mode
([`../agents.md`](../agents.md) rule 1;
[`owner-mode.md`](./owner-mode.md)):

- **Owner mode:** push the merge to main
  (`git push origin HEAD:main`). A rejected push means main
  moved: `git fetch origin`, `git merge origin/main`, the gate
  again, push again. Never rebase the merge.
- **Contributor mode:** push the branch and open a pull
  request (`git push origin sync/<date>`, then
  `gh pr create --base main`).

## Close the worktree

Close it only through the script, never a bare
`git worktree remove` (the script's header says why: git for
Windows follows a junction when it deletes a worktree). From
your main checkout, not from inside the worktree:

```bash
node scripts/worktree.mjs close ../nexus-wt/sync-2026-10-25
```

The script deletes the branch when main holds it; a sync that
never landed keeps its branch, and `git branch -D` drops it.
