# Validate claims

`fs-forge validate -f <file>` checks one or more claim files against their kind's schema and prints a JSON array with `file`, `kind`, `valid` and `errors` for each. It exits 0 when every file is valid and 1 when any is not. For a ComponentClaim with `features`, it also checks each Feature reference against a Feature source.

## Sub-features

- `validate-valid` accepts a valid claim of each kind.
- `validate-invalid` reports a specific error for each invalid claim and exits 1.
- `validate-multi` takes several `-f` flags and reports every file in one array.
- `validate-no-kind` reports a file with no `kind` field.
- `validate-feature-refs` checks Feature names, versions and args against the Feature source (`--source`).
- `validate-created` accepts what `create` printed; see [`create-claim.md`](./create-claim.md).

## How to get to it (user POV)

- Run `fs-forge validate -f claim.yaml` on a claim file, repeating `-f` for several.
- Run `fs-forge validate -f claim.yaml --source <dir or URL>` to check Features against a source other than the default.

## Driving it with drive.sh

Preconditions:

- `DOCTOR OK`; offline mode. `$F` is `packages/fs-forge-cli/__tests__/fixtures`.
- Seed the fixtures into the drive (`--seed $F/valid=valid`); the paths in the output are relative to the drive's work dir.
- A claim with `features` needs a local Feature source seeded the same way (`--seed $F/feature-sources=src`), or the drive hits the network and is voided.

- **All valid kinds.** Run `$V/drive.sh --label validate-valid-all --seed $F/valid=valid -- validate -f valid/argodeploy.yaml -f valid/component.yaml -f valid/domain.yaml -f valid/group.yaml -f valid/orgsettings.yaml -f valid/orgsettings-minimal.yaml -f valid/orgwebhook.yaml -f valid/secrets.yaml -f valid/system.yaml -f valid/tfworkspace.yaml -f valid/user.yaml`. Exit 0; `stdout.txt` holds 11 objects, and `grep -c '"valid": true' stdout.txt` prints 11. The console echo stops after 40 lines, so count in the file.
- **All invalid kinds.** Run `$V/drive.sh --label validate-invalid-six --expect-exit 1 --seed $F/invalid=invalid -- validate -f invalid/component-missing-owner.yaml -f invalid/group-missing-privacy.yaml -f invalid/no-kind.yaml -f invalid/orgsettings-missing-billing-email.yaml -f invalid/tfworkspace-missing-context.yaml -f invalid/user-missing-role.yaml`. The CLI exits 1 and the drive verdict is PASS. `grep -c '"valid": false' stdout.txt` prints 6, with these errors in order: `must have required property 'owner'`, `/providers/github must have required property 'privacy'`, `Claim is missing the required "kind" field` (with `"kind": null`), `/providers/github must have required property 'billing_email'`, `/providers/terraform must have required property 'context'`, `/providers/github must have required property 'role'`.
- **A claim `create` printed.** Run `create domain` as in `create-claim.md`, then `$V/drive.sh --label validate-created --seed <evidence dir of create-domain>/stdout.txt=claim.yaml -- validate -f claim.yaml`. Exit 0; `"valid": true`.
- **Feature references against a local source.** Take the claim a `features add` drive printed (see [`features-crud.md`](./features-crud.md)), then run `$V/drive.sh --label validate-features-local --seed <evidence dir of fcrud-add>/stdout.txt=c.yaml --seed $F/feature-sources=src -- validate -f c.yaml --source src`. Exit 0; `"valid": true`.
- **Feature errors.** Run `$V/drive.sh --label validate-feature-fixtures --expect-exit 1 --seed $F/invalid=invalid --seed $F/valid=valid --seed $F/feature-sources=src -- validate --source src -f invalid/component-feature-args.yaml -f invalid/component-malformed-features.yaml -f valid/component-with-features.yaml -f valid/component-with-nested-feature-args.yaml`. Exit 1; four `"valid": false` objects with, in order: `Feature feature_a: /enabled must be boolean`; `/providers/github/features must be array` and `providers.github.features must be an array`; `Feature other: Unknown Feature: other`; `Feature feature_a: must NOT have additional properties` and `Feature plain: Unknown Feature: plain`.
- **Proof.** Every drive has `net.log` empty and `files-changed.txt` empty. Keep the valid and invalid drives side by side: one proves acceptance, the other proves the schema is enforced.

## Gotchas

- `validate` has no `--json` flag: it always prints JSON, and `--json` fails with `Nonexistent flag` (exit 2).
- Exit 1 means at least one file is invalid, not that the CLI broke. Pass `--expect-exit 1` for invalid inputs or the drive reports FAIL.
- The fixtures named `valid/component-with-features.yaml` and `valid/component-with-nested-feature-args.yaml` are valid only against the real Feature catalog. Against the local `feature-sources` they fail with `Unknown Feature`, which the feature-errors drive above expects.
- Validating a claim with `features` and no `--source` makes the CLI fetch `raw.githubusercontent.com:443`. The offline canary blocks it, `net.log` records it, `drive.sh` exits 4 and the evidence says `Unable to read feature source ... fetch failed`. That run proves nothing; rerun it with `--source`.
- `validate` takes files, not stdin, and a drive has no stdin: seed the file and pass `-f`.
- Output paths are the paths you passed, relative to the drive's work dir; a seed with no `=DEST` lands under its own basename.
