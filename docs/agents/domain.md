# Domain Docs

How the engineering skills should consume this repo's domain documentation.

## Before exploring, read these

- **`CONTEXT-MAP.md`** at the repo root — it points at one `CONTEXT.md` per context/package.
- **`docs/adr/`** — system-wide architectural decisions.
- **`packages/<name>/CONTEXT.md`** — per-package domain context.
- **`packages/<name>/docs/adr/`** — package-scoped decisions.

If any of these files don't exist, **proceed silently**. Don't flag their absence.

## File structure

```
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← system-wide decisions
└── packages/
    ├── catalog_common/
    │   ├── CONTEXT.md
    │   └── docs/adr/
    ├── gh_provisioner/
    │   ├── CONTEXT.md
    │   └── docs/adr/
    └── ...
```

## Use the glossary's vocabulary

When naming a domain concept, use the term as defined in `CONTEXT.md`. If the concept isn't in the glossary, note it for `/domain-modeling`.

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding.
