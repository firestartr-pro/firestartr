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
| `--force` | off | Wipe a non-empty `--out` that lacks the `.bench-owned` marker. |
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

The generator selects `maintainedBy` from groups other than the component's
`owner` and `platformOwner`. If no distinct group is available (small tiers with
very few groups) the tool omits `maintainedBy` instead of emitting a colliding
permission, preventing GitHub permission-role conflicts during rendering.

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
| `--cpu-prof` | off | Write a V8 CPU profile next to the report (the report's directory is created first). |
| `--two-pass` | off | Re-render every provider that yields usable Kubernetes CRs, using that provider's first-pass output as previous CRs. |
| `--force` | off | Wipe a non-empty `--out` that lacks the `.bench-owned` marker. |
| `--allow-unverified` | off | Do not require a `generator-manifest.json` with a valid `total`; disables the loaded-claim completeness check. |
| `--help` | | Show usage. |

Both tools wipe `--out` before writing, and refuse any `--out` that would
destroy something they depend on. Symlinks are resolved first, so an alias is
caught. Two checks, neither overridable by `--force`:

- **Repository**: `--out` may not contain the repository, and if it lives inside
  it, only `<repo>/.tmp_dir` (the gitignored scratch root) is allowed. So
  `--out .`, `--out packages/cdk8s_renderer/src` and `--out docs` are all
  refused.
- **Inputs** (harness): `--out` may neither contain nor be inside any configured
  input (`--claims`, `--globals`, `--initializers`, `--claims-defaults`,
  `--crs`), so rendered output can never be written back into an input tree.

In addition, an existing **non-empty** `--out` that does not carry the
`.bench-owned` marker the tools write is refused unless `--force` is passed;
`--force` relaxes only that marker check, never the two checks above.

Phases timed, in order:

1. **discover** — `resolveClaimEntries` over the claims root.
2. **load** — `loadClaimsList` (read + parse + validate every claim).
3. **render+validate** — per provider, with lazy-loader and rendered-claim state
   reset before each provider.
4. **synth** — chart synthesis for the produced CRs and catalog entities. Both
   the CR app and the catalog app are synthesized, so a catalog-only pass
   actually writes (and counts) catalog YAML instead of measuring an empty app.

Peak memory is the **process-wide OS high-water RSS**
(`process.resourceUsage().maxRSS`), read once after the run. It is monotonic and
captures the synchronous synthesis peak, which an interval sampler cannot (the
event loop is blocked during synthesis) — so it is a process-wide peak, not a
per-run one. With `--repeat 3` the tool reports min/median/max over runs 1 and 2
(the warm-up is dropped). `--cpu-prof` writes `<report>.cpuprofile` (open it in
a V8 profile viewer), creating the report's directory first. `--two-pass`
exercises the previous-CR / diff path per provider: for each provider that
produced usable Kubernetes CRs in the first pass, it reloads with that
provider's own output directory as previous CRs and re-renders it, recording
`perProvider.<name>.twoPassRenderMs`. Providers with no usable previous CRs —
`catalog`, whose entities `getPreviousCRfromClaim` ignores, and any provider this
claim set has no data for — are skipped and listed in `twoPassSkipped`.

## Interpreting output

The stdout table shows discover/load medians, per-provider render and synth
times, the rendered-CR counts, and peak RSS. The JSON report contains:

- `seed`, `tier`, `org`, `claimsDir`, `providers`, `repeats`, `warmUpDropped`,
  `twoPass`, `node`, `generatedAt`;
- `discoveryMs` and `loadMs` (median plus range), `peakRssBytes` (process-wide
  OS high-water mark), `loadedClaims`, `expectedClaims`, `featureEnvelopes` and
  `featurePatches` (process totals);
- `perProvider.<name>`: `renderMs`, `synthMs`, `renderedCrs`, and
  `twoPassRenderMs` (null unless `--two-pass` measured that provider);
- `twoPassSkipped`, and the raw `rawRuns`.

The harness makes only two correctness assertions: every provider's render is
clean (no validation errors) and `loadedClaims` equals the generator's
`total`. There are no golden files and no timing thresholds — it reports
numbers, it does not judge them.

Stitching is mocked offline, but not as a no-op: for each claim the mock
synthesizes one `add` under `/annotations` per declared
`providers.github.features` entry (schema-valid, non-protected, keyed uniquely).
This makes the feature path run its normalization, conflict and apply phases
instead of short-circuiting on an empty envelope list; feature-free claims get
no patches. `featureEnvelopes`/`featurePatches` are process totals over the
whole run, so `0` means the catalog was feature-free or the mock was a no-op.

## Notes and limitations

- Everything is offline; there are no credentials or network calls.
- The generator sets only `providers.github`, so `github` produces Kubernetes
  CRs and `catalog` produces catalog entities; `terraform`, `externalSecrets`
  and `argocd` legitimately report `0` rendered entities on generator output.
  `--two-pass` therefore only measures `github` on generated claims, skipping
  the rest.
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
