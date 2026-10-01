# features_renderer

Turns feature packages (a `config.yaml` plus templates) into rendered files and config output, and owns the opt-in quality gate that validates user-supplied feature args against each feature's `schema.json`.

## Language

**Args validation flag**:
The `enable_validation: true` property in a feature's `config.yaml`. A feature opts into feature-arg validation by declaring it; absent or false, the feature renders without consulting its feature schema.
_Avoid_: validation_enable, validationEnabled

**Feature schema**:
A Draft-07 `schema.json` co-located in a feature package that describes the feature's user-feedable args; generated from `config.yaml` by the `prefapp/features` generator. Consulted only when the args validation flag is set.
_Avoid_: args schema, feature config schema

**User-feedable arg ($arg)**:
An argument a feature consumer may pass as a key in `featureArgs`; declared in `config.yaml` as an arg carrying `$arg`, and validated against the feature schema's `properties`.
_Avoid_: feature option, $default

**Traceability**:
Metadata (`owner`, `repo`, `name`, `version`, `ref`, `url`) injected by the feature downloader into `featureArgs` before rendering, and stripped before feature-arg validation so it never trips the unknown-key check.
_Avoid_: provenance stamp

**Feature claim-patch**:
A JSON Patch operation in a feature's `config.yaml` `claimPatches` flat array, applied to the claim during claim stitching via a claim-relative JSON Pointer (e.g. `/annotations/backstage.io~1techdocs-ref`). See `Claim stitching` and `Protected claim path` in `cdk8s_renderer/CONTEXT.md`.
_Avoid_: feature CR patch, provider-keyed patch, CR patch
