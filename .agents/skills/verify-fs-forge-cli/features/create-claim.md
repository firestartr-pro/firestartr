# Create a claim

`fs-forge create <kind>` builds a claim from flags, validates it against the kind's schema, and prints the claim as YAML. Without `--commit` it is local: nothing is written, no branch is made.

## Sub-features

- `create-print` prints a valid claim for a kind from its required flags.
- `create-schema-error` rejects a claim that violates the schema, naming each missing path.
- `create-required-flag` rejects a missing required flag before building anything.
- `create-kinds` covers every kind `kinds` lists: argodeploy, component, domain, group, orgsettings, orgwebhook, secrets, system, tfworkspace, user.
- `create-then-validate` checks that what `create` prints passes `validate`.
- `create-commit` is the write path (`--commit`); it lives in [`org-bound.md`](./org-bound.md).

## How to get to it (user POV)

- Run `fs-forge create <kind> --name <name> [flags]` in a terminal.
- Run `fs-forge create <kind> --help` to see the flags, or `--help --json` for the machine-readable form.

## Driving it with drive.sh

Preconditions:

- `DOCTOR OK`; offline mode (the default). No token and no org.
- `$F` is `packages/fs-forge-cli/__tests__/fixtures`; `$R` is the run's `evidence/` directory, printed on each `DRIVE` line.

- **Print a domain.** Run `$V/drive.sh --label create-domain -- create domain --name payments --description "Payments domain" --owner group:platform`. Exit 0; `stdout.txt` is a `DomainClaim` with `name: payments`, `owner: group:platform` and `providers: {}`; `files-changed.txt` is empty; `net.log` is empty.
- **Print a group.** Run `$V/drive.sh --label create-group -- create group --name platform --providers.github.name platform --providers.github.org my-org --providers.github.privacy closed`. `stdout.txt` is a `GroupClaim` whose `providers.github` holds `name`, `org` and `privacy: closed`.
- **Print a component.** Run `$V/drive.sh --label create-component -- create component --name my-api --owner group:platform --providers.github.name my-api --providers.github.org my-org --providers.github.visibility private --providers.github.branchStrategy.name gitflow`. `stdout.txt` is a `ComponentClaim` with `branchStrategy.name: gitflow`.
- **Schema error.** Run `$V/drive.sh --label create-schema-error --expect-exit 2 -- create group --name platform --providers.github.privacy closed`. Exit 2; `stderr.txt` lists ``/providers/github must have required property 'name'`` and the same for `'org'`; `stdout.txt` is empty.
- **Required flag.** Run `$V/drive.sh --label create-required-flag --expect-exit 2 -- create domain --name x`. Exit 2; `stderr.txt` names `Missing required flag description` and `Missing required flag owner`.
- **Cover the other kinds.** Each drive below exits 0 and starts `stdout.txt` with the kind named:
  - `-- create argodeploy --name my-app --providers.argocd.name my-app` prints `kind: ArgoDeployClaim`.
  - `-- create orgsettings --name my-org --providers.github.name my-org --providers.github.org my-org --providers.github.billing_email billing@example.com` prints `kind: OrgSettingsClaim`.
  - `-- create orgwebhook --name hook --providers.github.name hook --providers.github.orgName my-org --providers.github.webhook.url https://example.invalid/hook --providers.github.webhook.contentType json --providers.github.webhook.secretRef ref:secretsclaim:sec:token --providers.github.webhook.events push --providers.github.webhook.events pull_request` prints `kind: OrgWebhookClaim` with both events listed.
  - `-- create secrets --name sec --providers.external_secrets.name sec --providers.external_secrets.secretStore.name store --providers.external_secrets.secretStore.kind SecretStore --providers.external_secrets.externalSecrets.refreshInterval 1h --providers.external_secrets.externalSecrets.secrets.json '[]' --providers.external_secrets.pushSecrets.json '[]'` prints `kind: SecretsClaim`.
  - `-- create system --name sys` prints `kind: SystemClaim`.
  - `-- create tfworkspace --name ws --owner group:platform --providers.terraform.name ws --providers.terraform.source remote --providers.terraform.values.json '{}' --providers.terraform.context.providers.json '[]'` prints `kind: TFWorkspaceClaim`.
  - `-- create user --name alice --providers.github.name alice --providers.github.org my-org --providers.github.role member` prints `kind: UserClaim`.
- **Create, then validate.** Run `$V/drive.sh --label validate-created --seed $R/<NN>-create-domain/stdout.txt=claim.yaml -- validate -f claim.yaml`. Exit 0; `stdout.txt` has `"kind": "DomainClaim"` and `"valid": true`.
- **Proof.** Keep each `create-*` drive directory and its `validate-created` pair. `files-changed.txt` empty on every one shows `create` wrote nothing.

## Gotchas

- Usage text marks only some flags required. A kind's schema can require more, and `create` then fails with exit 2 and the schema paths. Orgwebhook needs `providers.github.name`, `orgName` and the whole `webhook` block; secrets needs `secretStore`, `externalSecrets` and `pushSecrets`; group, user and component need `providers.github.name` and `org`.
- `providers.github.webhook.secretRef` must match `ref:secretsclaim:<name>:<key>`; any other string fails with exit 2.
- Array flags repeat (`--providers.github.webhook.events push --providers.github.webhook.events pull_request`). The `.json` flags take a JSON string, so quote it for the shell.
- A failed `create` leaves `stdout.txt` empty. Seeding it into `validate` then fails on the empty file; that is the seed, not a `validate` bug.
- `--commit` on `create` is a write: it makes branch `fs-forge/<Kind>-<name>` in `<org>/claims` and dispatches provisioning. `drive.sh` refuses it outside `--mode write`, and offline mode refuses `--org` too.
