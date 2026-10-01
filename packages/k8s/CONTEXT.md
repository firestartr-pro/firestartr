# k8s

Firestartr CRD definitions (`firestartr.dev` group) consumed across the
pipeline. This glossary covers CRD authoring concepts; detailed CRD rules live in
`packages/k8s/RULES.md §13`. Other areas are authored lazily via
`/domain-modeling` as the package is touched.

## Language

**Firestartr CRD**:
A CRD in the `firestartr.dev` group whose schema mirrors a TFM module's
`variables.tf`.
_Avoid_: resource definition, manifest

**Syntactic validation**:
OpenAPI structural rules only; the schema carries no semantic or uniqueness
checks.
_Avoid_: schema validation, checks

**Singleton intent**:
At most one CR of a kind per GitHub org, enforced by claim/render logic, not the
schema.
_Avoid_: unique, constraint
