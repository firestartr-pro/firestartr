# Introspect the CLI

The self-describing commands tell a user, or another tool, what `fs-forge` can do without touching a claim: `kinds` lists the claim kinds with their capabilities, `kinds show` prints one of them, `schema` prints the CLI's own JSON schemas, `<command> --help --json` describes a command, and `diagram print` renders a relation graph file as a tree.

## Sub-features

- `kinds-table` lists the ten claim kinds as a table.
- `kinds-json` prints the same list as JSON (`kinds --json`), each entry carrying the full capability shape.
- `kinds-show` prints one kind's capabilities, as rows or JSON (`kinds show <kind> [--json]`), in the same shape as a `kinds --json` entry.
- `schema-list` and `schema-show` list and print the CLI's JSON schemas.
- `help-json` prints a command's help as JSON that follows the `CommandHelpJson` schema.
- `diagram-print` renders a relation graph as a unicode tree, or as ASCII with `--ascii`.
- `diagram-invalid` rejects a graph that breaks the `RelationGraph` schema.

## How to get to it (user POV)

- Run `fs-forge kinds` or `fs-forge kinds --json`.
- Run `fs-forge kinds show component`, or `fs-forge kinds show ComponentClaim --json`.
- Run `fs-forge schema list`, then `fs-forge schema show <name>`.
- Run `fs-forge <command> --help --json`, for example `create domain --help --json`.
- Run `fs-forge diagram print -f graph.json [--ascii]`.

## Driving it with drive.sh

Preconditions:

- `DOCTOR OK`; offline mode. `$F` is `packages/fs-forge-cli/__tests__/fixtures`.
- `diagram print` reads a file with `-f`; a drive has no stdin, so seed the graph (`--seed $F/relation-graphs=g`).

- **Kinds table.** Run `$V/drive.sh --label intro-kinds -- kinds`. `stdout.txt` has the header `ID KIND DESCRIPTION` and ten rows: argodeploy, component, domain, group, orgsettings, orgwebhook, secrets, system, tfworkspace, user, each with its `<Kind>Claim` name.
- **Kinds JSON.** Run `$V/drive.sh --label intro-kinds-json -- kinds --json`. `jq 'length' stdout.txt` prints 10, and every object has the keys `catalogOnly`, `claimsDirectory`, `delete`, `description`, `hydration`, `id`, `kind`, `orgField`, `preflight`, `references`, `requiresPath`, `stateRepo` and `variants`. The component entry has `"claimsDirectory": "components"`, `"hydration": {"workflow": "hydrate-github-claim.yaml", "key": "name", "inputs": ["kind", "name"]}`, `"delete": {"supported": true, "workflow": "delete-github-claim.yaml"}` and `"stateRepo": "state-github"`; the domain entry has `"hydration": null`, `"delete": {"supported": false, "workflow": null}` and `"references": ["owner"]`.
- **One kind.** Run `$V/drive.sh --label intro-kinds-show -- kinds show tfworkspace`: `stdout.txt` starts with `TFWorkspaceClaim (tfworkspace)`, and the rows say `requires --path   yes`, `variants          yes`, `state repo        state-infra` and `references        system, owner, providers.terraform.values.**`. The `.**` suffix denotes any field at any depth below that path. Then `... --label intro-kinds-show-json -- kinds show tfworkspace --json`: `jq -r '.kind, .hydration.workflow' stdout.txt` prints `TFWorkspaceClaim` and `hydrate-tfworkspace-claim.yaml`.
- **Unknown kind.** Run `$V/drive.sh --label intro-kinds-show-unknown --expect-exit 2 -- kinds show nope`. Exit 2; `stderr.txt` says `Expected nope to be one of:` and lists the ids and kind names.
- **Schemas.** Run `$V/drive.sh --label intro-schema-list -- schema list`: `NAME` followed by `CommandHelpJson`, `RelationGraph` and `MutationDiff`. Then `... --label intro-schema-show -- schema show MutationDiff`: a JSON schema with `"title": "MutationDiff"` and `"additionalProperties": false`.
- **Unknown schema.** Run `$V/drive.sh --label intro-schema-unknown --expect-exit 2 -- schema show Nope`. Exit 2; `stderr.txt` says `Unknown schema: Nope. Valid schemas: CommandHelpJson, RelationGraph, MutationDiff`.
- **Help as JSON.** Run `$V/drive.sh --label intro-help-json -- create domain --help --json`. `jq -r '.id' stdout.txt` prints `create:domain`.
- **Audit flags in help.** Run `$V/drive.sh --label intro-help-json-audit -- create domain --help --json` and `... -- edit --help --json`. In both, `jq -r '.flags[].path' stdout.txt` lists `issue`, `create-issue`, `issue-title` and `issue-body`, and the `issue` description names the `Closes #N` footer. Same for `delete --help --json` and `features add --help --json`.
- **Diagram.** Run `$V/drive.sh --label intro-diagram --seed $F/relation-graphs=g -- diagram print -f g/valid.json`. `stdout.txt` is `❓ team: platform` and `└─ ❓ service: api (owns)`. With `--ascii` (label `intro-diagram-ascii`) the marker is `[???]` in place of `❓`.
- **Known kinds.** Run `$V/drive.sh --label intro-diagram-known --seed $V/../fixtures/relation-graph-known.json=g.json -- diagram print -f g.json`. `stdout.txt` is `🌐 DomainClaim: payments` and `└─ 🧩 ComponentClaim: api (contains)`. With `--ascii` the markers are `[DOM]` and `[CMP]`.
- **Invalid graph.** Run `$V/drive.sh --label intro-diagram-invalid --expect-exit 2 --seed $F/relation-graphs=g -- diagram print -f g/invalid.json`. Exit 2; `stderr.txt` says `Invalid relation graph:` and `/nodes/0 must have required property 'name'`; `stdout.txt` is empty.
- **Proof.** Cross-check one view against another: the ten `kinds --json` ids match the ten `create <id>` rows of `$V/drive.sh --label intro-create-help -- create --help`, `kinds show component --json` prints exactly the component entry of `kinds --json`, and `schema show` prints the same `title` as the name in `schema list`. Every drive has `net.log` and `files-changed.txt` empty.

## Gotchas

- `kinds` and `create --help` list the same ten kinds. When a kind is added to one and not the other, the cross-check above fails, and that is the finding.
- `kinds show` accepts the short id and the full kind name, but nothing else: `kinds show Component` fails. Its JSON is one object, not a list.
- `kinds --json` and `kinds show --json` report what a claims repo dispatches, not what `delete` does: `delete` still sends `unprovision-claim.yaml` for every kind, so a kind with `"delete": {"supported": false}` is rejected by the claims repo, not by the CLI.
- The package's `relation-graphs/valid.json` uses node kinds `team` and `service`, which are not claim kinds, so it renders the unknown marker (`❓`, ascii `[???]`). Use the skill's `fixtures/relation-graph-known.json` to see real kind markers.
- A graph that is valid JSON but breaks the schema exits 2 with the schema path, not 1.
- `schema show` is case-sensitive: `mutationdiff` exits 2 with `Unknown schema: mutationdiff` and the list of valid names.
- A drive has no stdin, so `diagram print` is driven with `-f`.
