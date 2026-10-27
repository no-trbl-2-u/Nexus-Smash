---
description: Under Improve bold, propose edits to one verb's skill from its recent runs (night verb; never dispatched by march)
argument-hint: "<verb> [--dry]"
---

You are invoked under the `refine` skill. Read `skills/refine.md`
end to end before touching anything else; it is the single
source of truth.

Argument handling:
- `<verb>` → gate on the dial, write the evidence context, propose
  two `inv` and two `dom` candidates or `KEEP_BASE`, check them.
- `<verb> --dry` → say what would be written; write nothing.
- No argument → stop and print the usage line.

Below `Improve: bold` the script prints one reason line and the
run is over. Never edit a tracked file from this command.

Argument: $ARGUMENTS
