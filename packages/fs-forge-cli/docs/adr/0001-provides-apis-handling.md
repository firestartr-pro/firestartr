# ADR 0001 — JSON escape hatches for complex schema values

**Status:** Accepted

**Date:** 2026-07-12

## Context

Some claim fields cannot be represented faithfully as simple repeatable flags. For
example, `ComponentClaim.providesApis` accepts either an array of API definitions or
a name-keyed object. Each API definition uses the schema fields `name`,
`definitionfile`, and `type`.

The same problem occurs for object arrays, dynamic objects, and nested union values
across other claim schemas.

## Decision

The flag derivation pipeline exposes complex values through the existing
`--<path>.json` convention while retaining useful simple leaf flags where the schema
has an unambiguous property path.

For example:

```sh
fs-forge create component \
  --name my-service \
  --owner group:platform \
  --providesApis.json '[{"name":"users","definitionfile":"openapi.yaml","type":"rest"}]'
```

JSON values are parsed before AJV validates the complete claim. Invalid JSON is
reported against the supplied flag. No synthetic discriminator or indexed array flag
syntax is introduced.

## Consequences

- Every writable complex schema field has one deterministic CLI representation.
- The CLI avoids inventing a second shape language for unions and dynamic keys.
- Users receive whole-value AJV validation rather than incremental validation while
  entering JSON.
