# Package Rules - All Packages

> These rules apply to every package under `packages/`.
> They extend and are stricter than the root Constitution (`CONSTITUTION.md`) and `AGENTS.md`.
> They **MUST NOT** contradict or weaken any higher-precedence rule.

## 1. Precedence Within Package Rules

When working in a package, apply rules in this order:

1. `CONSTITUTION.md`
2. `AGENTS.md` for AI agents
3. `packages/RULES.md`
4. `packages/<name>/RULES.md`, when present

Package-specific `RULES.md` files may add stricter requirements for their package, but they must not contradict or weaken this file or any higher-precedence rule.
