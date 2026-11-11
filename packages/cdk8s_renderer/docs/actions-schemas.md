# Action schemas

The existing `@firestartr/firestartr-claims_schemas` artifact publishes five
draft-07 schemas through `actions` and `actions/*`:

```ts
import { schemas } from '@firestartr/firestartr-claims_schemas/actions';
const config = schemas.config;
```

Individual files use `actions/<name>.schema.json`:

| Name                    | Source under `src/schemas/`                  |
| ----------------------- | -------------------------------------------- |
| `config`                | `actions/config.schema.ts`                   |
| `build-images-results`  | `actions/build_images_results.schema.ts`     |
| `firestartr-apps`       | `dot-firestartr/apps.schema.ts`              |
| `firestartr-platforms`  | `dot-firestartr/platforms.schema.ts`         |
| `firestartr-registries` | `dot-firestartr/docker_registries.schema.ts` |

These are data schemas, not claims: they are excluded from `ALL_SCHEMAS` and
the claim directory. TypeScript remains the source of truth; JSON is generated
for publication. Actions inherit the artifact's version and release workflow.
The existing docs-promotion channel is unchanged; actions are npm-only.

## Compatibility

The action baseline is `prefapp/action-make-state-repos-dispatches` commit
`a123c7c` (4.3.3). Three approved differences apply:

- Registry `auth_strategy` retains the canonical enum: `aws_oidc`, `azure_oidc`,
  `generic`, `ghcr`, `dockerhub`, `none`, instead of any string.
- Descriptive metadata is retained, but action JSON omits `$id` so both views
  compile in one Ajv instance without duplicate identities.
- `config.version` is anchored once and follows the action ref helper:
  `$latest_release`, `$latest_prerelease`, `$branch_<branch>`,
  `$highest_semver_release_<suffix>`, `$highest_semver_prerelease_<suffix>`,
  or a nonempty plain version using `[a-z0-9 _.-]+`. Branches allow
  `[A-Za-z0-9._/-]+`; semver suffixes allow `[A-Za-z0-9._/+-]+`.
  Bare `$highest_semver`, empty branch suffixes, and suffixed
  `$latest_release`/`$latest_prerelease` are rejected.

Build results and registry configuration share `registry-host.ts`, including
the no-port rationale. Build summaries allow arbitrary extra metadata.
Migration of the action repository is separate from this publication change.
