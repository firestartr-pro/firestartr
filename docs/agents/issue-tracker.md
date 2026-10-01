# Issue tracker

This repo uses **GitHub Issues** via the `gh` CLI. No tracker abstraction;
skills act on whatever repo they run in.

## Wayfinding operations

Maps and tickets are GitHub issues (see the `wayfinder` skill). This repo uses
GitHub **native** sub-issues and issue dependencies — `gh` ≥ 2.95 supports them
directly, no extension.

- **Map:** an issue labelled `wayfinder:map`. List: `gh issue list --label wayfinder:map`.
- **Ticket:** a child issue of the map, labelled `wayfinder:<type>` (`grilling`,
  `research`, `prototype`, `task`). Parent it with `gh issue edit <n> --parent <map>`.
- **Blocking (native):** `gh issue edit <n> --add-blocked-by <m>` /
  `--add-blocking <m>`. Also available at create: `gh issue create --blocked-by`.
- **Claim a ticket:** `gh issue edit <n> --add-assignee @me` before any work.
- **Frontier** (open, unblocked, unclaimed children of a map): open sub-issues
  with no assignee whose every `--add-blocked-by` issue is closed. Inspect one
  ticket's blockers: `gh issue view <n> --json title,assignees` plus the
  "blocked by" panel in `gh issue view <n>`.
- **Resolve:** post a resolution comment (`gh issue comment <n>`), close it
  (`gh issue close <n>`), and append a one-line context pointer to the map's
  "Decisions so far".
