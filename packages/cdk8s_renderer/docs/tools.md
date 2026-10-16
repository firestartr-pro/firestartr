# Renderer benchmark tools

Two offline, reproducible tools for stress-testing the `cdk8s_renderer`: a
seeded claims-directory generator and a render benchmark harness. They answer
"how does the renderer behave at N claims?" and let you compare a run before and
after a change. Neither needs credentials or network access.

Both live in `packages/cdk8s_renderer/tools/` and are run from the repo root. The
generator's output and the harness's defaults agree on `<repo>/.tmp_dir/bench`,
so the common flow is two commands:

```sh
node packages/cdk8s_renderer/tools/generate-claims.mjs
node packages/cdk8s_renderer/tools/bench-render.cjs
```

The generator writes a claims directory; the harness renders it and prints a
per-phase table, then writes a JSON report.

## `generate-claims.mjs`

Generates a synthetic claims directory by spawning the Firestartr CLI
(`fs-forge create <kind>`) once per claim and capturing its stdout, so the CLI's
schemas and defaults stay the source of truth. The generator runs the CLI
straight from its TypeScript sources via a small launcher written into the output
directory (`.fs-forge-launcher.mjs`); nothing in the repo is built or modified.
The output directory is wiped on every run.

```sh
node packages/cdk8s_renderer/tools/generate-claims.mjs [options]
```

| Flag | Default | Meaning |
|---|---|---|
| `--out <dir>` | `<repo>/.tmp_dir/bench` | Output bench directory. |
| `--tier <n>` | `1000` | Total claim count. Canonical sizes are `100`, `1000`, `10000`; any integer `>= 10` is accepted so tests can use a small tree. |
| `--seed <n>` | `80` | PRNG seed. The same seed and tier produce a byte-identical tree. |
| `--jobs <n>` | `8` | Concurrent `fs-forge` spawns. |
| `--org <name>` | `bench` | GitHub org written into provider fields. |
| `--help` | | Show usage. |

Output layout:

```
<out>/claims/{components,groups,users,systems,domains,orgSettings}/
<out>/globals/                     copy of __tests__/fixtures/globals
<out>/initializers/                copy of __tests__/fixtures/initializers
<out>/.config/claims_defaults.yaml
<out>/generator-manifest.json
```

The generated set is wired up rather than flat: domains own systems, systems own
components; groups carry members and sparse parent groups; components are
hub-heavy (a few hubs expose and consume many APIs, most expose about one); each
claim draws its features from a local feature catalog; and a single
`orgSettings` claim is always emitted. `generator-manifest.json` records the
`seed`, `tier`, `org`, per-kind counts and `total`, which the harness uses as its
correctness guard.

## `bench-render.cjs`

Renders a generated claims directory and measures each phase. It runs through
`tools/bench-render.cjs` — a CommonJS wrapper (see
[ADR 0002](adr/0002-render-claims-cjs-shim-exception.md)) that hands off to
`bench-render.ts`.

```sh
node packages/cdk8s_renderer/tools/bench-render.cjs [options]
```

| Flag | Default | Meaning |
|---|---|---|
| `--claims <dir>` | `<repo>/.tmp_dir/bench/claims` | Claims root. |
| `--globals <dir>` | `<repo>/.tmp_dir/bench/globals` | Globals dir. |
| `--initializers <dir>` | `<repo>/.tmp_dir/bench/initializers` | Initializers dir. |
| `--claims-defaults <dir>` | `<repo>/.tmp_dir/bench/.config` | Claims defaults dir. |
| `--crs <dir>` | `<repo>/.tmp_dir/bench/crs` | Previous-CRs dir. |
| `--out <dir>` | `<repo>/.tmp_dir/bench/out` | Scratch output for rendered CRs. |
| `--org <name>` | `bench` | Org used for repository URLs. |
| `--providers <list>` | `catalog,github,terraform,externalSecrets,argocd` | Comma-separated providers to render. |
| `--repeat <n>` | `3` | Measured repeats. Run 0 is a warm-up and is excluded from the stats. |
| `--json <path>` | `<repo>/.tmp_dir/bench/report.json` | Report path. |
| `--cpu-prof` | off | Write a V8 CPU profile next to the report. |
| `--two-pass` | off | Render once, then re-render using the produced CRs as previous CRs. |
| `--help` | | Show usage. |

Phases timed, in order:

1. **discover** — `resolveClaimEntries` over the claims root.
2. **load** — `loadClaimsList` (read + parse + validate every claim).
3. **render+validate** — per provider, with lazy-loader and rendered-claim state
   reset before each provider.
4. **synth** — chart synthesis for the produced CRs.

Peak process RSS is sampled across the run. With `--repeat 3` the tool reports
min/median/max over runs 1 and 2 (the warm-up is dropped). `--cpu-prof` writes
`<report>.cpuprofile` (open it in a V8 profile viewer). `--two-pass` exercises
the previous-CR / diff path: it re-loads with the first provider's produced CRs
and records `twoPassRenderMs`.

## Interpreting output

The stdout table shows discover/load medians, per-provider render and synth
times, the rendered-CR counts, and peak RSS. The JSON report contains:

- `seed`, `tier`, `org`, `claimsDir`, `providers`, `repeats`, `warmUpDropped`,
  `twoPass`, `node`, `generatedAt`;
- `discoveryMs` and `loadMs` (median plus range), `peakRssBytes`,
  `loadedClaims`, `expectedClaims`;
- `perProvider.<name>`: `renderMs`, `synthMs`, `renderedCrs`;
- `twoPassRenderMs` and the raw `rawRuns`.

The harness makes only two correctness assertions: every provider's render is
clean (no validation errors) and `loadedClaims` equals the generator's
`total`. There are no golden files and no timing thresholds — it reports
numbers, it does not judge them.

## Notes and limitations

- Everything is offline; there are no credentials or network calls.
- The generator emits github/catalog claims, so those providers produce CRs.
  Other providers may legitimately report `0` rendered CRs on generator output.
- TFWorkspace claims are out of scope; the tools are not wired to remote-derived
  schemas.
- The measured load time depends on the renderer revision under test. A
  performance fix may live on a separate branch, in which case the numbers
  reflect whatever code is currently checked out.

## Examples

Large run with a custom output directory:

```sh
node packages/cdk8s_renderer/tools/generate-claims.mjs --out /tmp/bench --tier 10000 --seed 42 --jobs 16
node packages/cdk8s_renderer/tools/bench-render.cjs \
  --claims /tmp/bench/claims \
  --globals /tmp/bench/globals \
  --initializers /tmp/bench/initializers \
  --claims-defaults /tmp/bench/.config \
  --out /tmp/bench/out \
  --json /tmp/bench/report.json
```

Quick single-provider check with a fresh report:

```sh
node packages/cdk8s_renderer/tools/bench-render.cjs --providers catalog --repeat 2 --json /tmp/bench/catalog.json
```

Profile a run and exercise the previous-CR path:

```sh
node packages/cdk8s_renderer/tools/bench-render.cjs --two-pass --cpu-prof
```
