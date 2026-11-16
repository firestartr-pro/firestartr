# `.firestartr` organization schemas

The action-facing view reuses these canonical sources; see
[action schemas](actions-schemas.md). Registry host validation and its no-port
rationale are shared through `src/schemas/registry-host.ts`.

Four draft 2020-12 schemas for `.firestartr` organization configuration live in
`src/schemas/dot-firestartr/` and ship with the generated
`@firestartr/firestartr-claims_schemas` npm package.

| Directory            | Schema                                                    |
| -------------------- | --------------------------------------------------------- |
| `apps/`              | `src/schemas/dot-firestartr/apps.schema.ts`               |
| `platforms/`         | `src/schemas/dot-firestartr/platforms.schema.ts`          |
| `docker_registries/` | `src/schemas/dot-firestartr/docker_registries.schema.ts`  |
| `helm_repositories/` | `src/schemas/dot-firestartr/helm_repositories.schema.ts`  |

`platforms/` is canonical; `clusters/` is a legacy consumer directory name.
Schemas are exported individually and together in a `schemas` map:

```ts
import { schemas } from '@firestartr/firestartr-claims_schemas/dot-firestartr';

const appSchema = schemas.apps;
```

Individual JSON files are available at
`@firestartr/firestartr-claims_schemas/dot-firestartr/apps.schema.json` and the
other filenames in the table.

Schemas are published only through npm, with the artifact's release version.
Pin the npm dependency for reproducible consumption. Schemas omit `$id` and
can be compiled alongside the action view in the same validator instance.
Docs-repository promotion is discontinued; any existing docs-hosted copies are
not updated by this repository.

## Compatibility

Applications and platforms preserve the action schemas' validation rules.
Registries preserve those rules but restrict `auth_strategy` to `aws_oidc`,
`azure_oidc`, `generic`, `ghcr`, `dockerhub` or `none`. **Previously accepted
arbitrary authentication strategy strings are now rejected.** Registry hosts
cannot contain ports. Helm repositories require a non-empty name and a URL
beginning with `http://`, `https://` or `oci://`.

Upstream sources:

- `prefapp/action-make-state-repos-dispatches` at
  `a123c7c934dbf216841810ae3da2d1b5fcf93710`:
  `schema/firestartr-{apps,platforms,registries}.schema.json`.
- `prefapp/daggerverse` at `39c6b99f380f375c57364b611ea65f2d5a17a470`:
  `firestartr-config/{registries,repositories}.go`.
