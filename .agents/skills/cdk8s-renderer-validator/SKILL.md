---
name: cdk8s-renderer-validator
description: Validate a change to packages/cdk8s_renderer (claim loading, rendering, patch pipeline, validations, schemas) with unit tests, renders, schema checks, cluster dry-runs and flood tests, and report HEALTHY, DEGRADED or BROKEN.
---

# cdk8s-renderer-validator

## Setup

- Scaffold the working directory with
  `packages/cdk8s_renderer/tools/setup-render-context.sh` (`--clean` resets
  it). Never build `.tmp_dir/` by hand.
- Render working claims, never base claims: clone and patch one with
  `node packages/cdk8s_renderer/tools/patch-claim.mjs <claim> --patch <json> --flag clone --result-path <dest>`.
- Rendering feature claims needs `PREFAPP_BOT_PAT` exported and written to
  `.tmp_dir/.token`.
- Cluster validation needs `packages/operator/tools/dev-operator.sh startup`.

Run any tool with `--help` for flags and default paths.

## What to run

| Changed | Check |
|---|---|
| Regenerated CDK8s imports | Unit tests, lint, render, cluster validation |
| Charts or claims rendering | Render each affected chart type, cluster validation |
| Patch pipeline (normalizers, initializers, overriders, globals, defaults) | Render a working claim that exercises the stage; check the fields; cluster validation |
| `src/validations` | Render a passing and a failing working claim; check exit code and error |
| Schemas | `validate-claim-against-schema` on base claims, then render to confirm enforcement |
| Loader, ref resolver, crawler | Flood test: 100+ cross-referenced working claims render with no failures, duplicates or timeouts |
| Single kind or chart | Render a cloned working claim with field changes |
| Catalog | `node tools/render-claims.cjs --provider catalog`; check the Backstage YAML |
| Config, constants, anything else | Unit tests for the area (`__tests__/` mirrors `src/`) |

- Render: `node tools/render-claims.cjs --claim <claim> --provider <all|github|terraform|catalog|…>`.
- Cluster validation: `dev-operator.sh apply <rendered-cr-dir>`, or
  `exec kubectl apply --dry-run=server -f …`.
- Idempotency: render again with `--crs-dir` set to the previous output; there
  must be no diff.

Report HEALTHY, DEGRADED or BROKEN, the affected stage, and one PASS/FAIL line
per check, with only the log lines that matter.

## Limits

- Write only inside `.tmp_dir/`, and never commit `.tmp_dir/.token`.
- Don't start, stop or `down` the operator; the cluster is shared. Use only
  `startup`, `exec` and `apply`.
