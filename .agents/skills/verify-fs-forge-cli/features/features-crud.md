# Manage Features on a claim

`fs-forge features` discovers the Features a source offers and adds, edits, lists or removes Feature references on a ComponentClaim. With a local `--file`, `add`, `edit` and `remove` print the changed claim to stdout and leave the file as it was.

## Sub-features

- `features-discover` lists the Features in a source with their latest version and files.
- `features-versions` lists one Feature's versions (`--versions`).
- `features-schema-readme` prints a Feature's schema (`--schema name@version`), README (`--readme`) or changelog (`--changelog`).
- `features-add` adds a Feature to the claim, with schema-derived `--args.*` flags.
- `features-list` prints the claim's Feature references.
- `features-edit` changes a Feature's version or args.
- `features-remove` removes a Feature reference.
- `features-args-help` shows the `--args.*` flags a Feature's schema generates.
- `discovery features` is an alias of `features discover`.

## How to get to it (user POV)

- Run `fs-forge features discover [--source <dir or URL>]` to browse a source; `discovery features` does the same.
- Run `fs-forge features add|edit|remove|list --file claim.yaml [--name <feature>] [--source <dir>]` on a claim file.
- Run `fs-forge features add --name <feature> --source <dir> --help` to see the Feature's own `--args.*` flags.
- Without `--file`, `features add|edit|remove|list <component>` reads the component from the org's claims repo: that path is in [`org-bound.md`](./org-bound.md).

## Driving it with drive.sh

Preconditions:

- `DOCTOR OK`; offline mode. `$F` is `packages/fs-forge-cli/__tests__/fixtures`.
- Seed the local source as `--seed $F/feature-sources=src` and pass `--source src` on every command that reads Features. Without a source the default URL is fetched, and the offline canary voids the drive.
- Seed a claim to edit as `--seed $F/valid/component.yaml=c.yaml`, and chain later drives off the `add` drive's `stdout.txt`.

- **Discover.** Run `$V/drive.sh --label fcrud-discover --seed $F/feature-sources=src -- features discover --source src`. `stdout.txt` is the table `NAME VERSION FILES` with `feature_a  1.1.0  README.md, CHANGELOG.md`.
- **Alias.** Run `$V/drive.sh --label fcrud-alias --seed $F/feature-sources=src -- discovery features --source src`. The output is identical to `fcrud-discover`.
- **Versions.** Run `$V/drive.sh --label fcrud-versions --seed $F/feature-sources=src -- features discover --source src --versions feature_a`. Two rows under `VERSION DATE SCHEMA`: 1.1.0 and 1.0.0.
- **Schema and README.** Run `... -- features discover --source src --schema feature_a@1.1.0` for the JSON schema (`"title": "feature_a args"`), and `... --readme feature_a` for `# Feature A` followed by `Fixture feature documentation.` Use `--changelog feature_a` for the changelog.
- **Add.** Run `$V/drive.sh --label fcrud-add --seed $F/valid/component.yaml=c.yaml --seed $F/feature-sources=src -- features add --file c.yaml --name feature_a --version 1.0.0 --source src --args.enabled --args.ratio=2.5 --args.tags=a --args.tags=b`. Exit 0; `stdout.txt` is the component claim with `features:` holding `feature_a` 1.0.0 and args `enabled: true`, `ratio: 2.5`, `tags: [a, b]`, plus the schema defaults `weights: [1.5]` and `retries: [3]`. `files-changed.txt` is empty: the claim file did not change.
- **Validate what add printed.** Run the `validate-features-local` drive from [`validate-claim.md`](./validate-claim.md), seeded from this drive's `stdout.txt`. `"valid": true`.
- **List.** Run `$V/drive.sh --label fcrud-list --seed <evidence dir of fcrud-add>/stdout.txt=c.yaml -- features list --file c.yaml --json`. `stdout.txt` is a JSON array with one object: `name: feature_a`, `version: 1.0.0` and the args above. `features list` has no `--source` flag.
- **Edit.** Run `$V/drive.sh --label fcrud-edit --seed <fcrud-add evidence>/stdout.txt=c.yaml --seed $F/feature-sources=src -- features edit --file c.yaml --name feature_a --version 1.1.0 --source src`. `stdout.txt` shows `version: 1.1.0` with the args kept; `files-changed.txt` is empty.
- **Remove.** Run `$V/drive.sh --label fcrud-remove --seed <fcrud-add evidence>/stdout.txt=c.yaml -- features remove --file c.yaml --name feature_a`. `stdout.txt` ends the component with `features: []`.
- **Args help.** Run `$V/drive.sh --label fcrud-args-help --seed $F/feature-sources=src -- features add --name feature_a --source src --help`. The flag list includes `--[no-]args.enabled`, `--args.ratio=<value>`, `--args.tags=<value>...` (default `stable`), `--args.weights`, `--args.retries` and `--args.json=<value>`.
- **Proof.** For each mutating drive, the printed claim differs from its seed and `files-changed.txt` is empty. The chain add, validate, list, edit, remove shows the claim stays consistent at every step.

## Gotchas

- `features discover` takes its Feature as a value: `--versions feature_a`, `--schema feature_a@1.1.0`, `--readme feature_a`, `--changelog feature_a`. A positional `features discover feature_a` exits 2 with `command features:discover:feature_a not found`.
- Boolean args take no value: `--args.enabled` or `--no-args.enabled`. `--args.enabled=true` fails with the misleading `Provide exactly one target: positional COMPONENT or --file <path>`.
- Array args repeat and replace: `--args.tags=a --args.tags=b` sets `[a, b]`. `--args.json` passes a raw JSON object for all args.
- The `--args.*` flags and their defaults come from the latest schema, even when `--version` names an older one. The 1.0.0 schema in the fixture source is the URL `https://example.invalid/...`, which is never fetched in an offline drive.
- The Feature cache is per Feature name (`FS_FORGE_FEATURE_CACHE_DIR`), and a cached copy hides changes to a source. `drive.sh` gives each drive its own empty cache, so run a second command in a fresh drive, not by reusing a cache.
- Nothing here writes the claim file. Rerunning `features add` on the original seed adds the Feature again from scratch; chain from the printed output instead.
