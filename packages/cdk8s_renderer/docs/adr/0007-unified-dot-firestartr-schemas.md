# Unified .firestartr organization schemas live in cdk8s_renderer

The action's JSON Schemas and daggerverse's Go models drifted apart. A single
authoring source avoids accepting different `.firestartr` configurations across
consumers. Issue #185 asks for that source to be published as npm with the root
Firestartr release version.

The four draft-07 schemas (`apps`, `platforms`, `docker_registries`,
`helm_repositories`) live under `src/schemas/dot-firestartr/` as TypeScript
default exports, matching the existing `cdk8s_renderer` authoring convention.
They ship in the generated `@firestartr/firestartr-claims_schemas` artifact,
under `dot-firestartr/`, rather than in a second package. This keeps one release
line and one npm trusted publisher, and avoids a workspace package that only
wraps JSON. JSON is generated for npm and for the docs repository; the
TypeScript source remains authoritative.

The merge retains the recovered upstream contracts without additional
tightening. Stable releases advance docs `latest/`; prereleases only publish
their pinned directory and npm `prerelease` tag. Consumers migrate independently
in action issue #166 and daggerverse issue #506.
