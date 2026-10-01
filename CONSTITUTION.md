# Constitution: TypeScript Monorepo with Lerna

> This document is the **supreme law** of the repository.  
> All code, decisions, PRs, and AI assistance **MUST** follow it.

## 1. Purpose

This Constitution defines the non-negotiable rules for the entire TypeScript monorepo managed with Lerna and npm workspaces.

## 2. Core Principles (Non-Negotiable)

- Type safety first — TypeScript settings must move toward repository-wide strict mode; until migration is complete, contributors must not reduce existing type-safety guarantees
- Quality, security, and performance are mandatory
- Every package must have a clear single responsibility

## 3. Technical Rules

- TypeScript ^5.0
- Current baseline: the root `tsconfig.json` may remain non-strict during migration; repository policy is to incrementally enable stricter compiler checks rather than weaken them
- New packages and newly introduced `tsconfig` files should enable `strict: true` unless a documented repository-wide exception is approved in review
- Changes to existing packages must not disable additional strictness flags, and any strictness increase is preferred when it does not change runtime behavior
- Use ES module `import`/`export` syntax for new code by default; existing legacy CommonJS `require(...)` usages may remain temporarily during migration, but contributors must not introduce new `require(...)` calls or expand existing usage unless a documented exception is explicitly approved in review, and touched legacy usages should be migrated when doing so does not change runtime behavior
- Dynamic imports (`import(...)`) are forbidden by default because final compilation uses `ncc`; they may be used only when a documented exception is explicitly approved in review
- Jest for testing
- ESLint + Prettier enforced
- Lerna for versioning and publishing
- Root configuration files must be extended by every package

## 4. Package Structure (Mandatory)

### 4.0 Repository Path Boundaries (Mandatory)

- Application and package code **MUST** live under the repository-root `packages/` directory. `packages/` is the only valid root location for package and application code, unless this Constitution is changed by review.
- **Code is the source of truth for behavior.** No document may stand in for the code as the description of *what the system does*.
- **Shared vocabulary** lives in `CONTEXT.md`. In this monorepo a root `CONTEXT-MAP.md` points at one `CONTEXT.md` per package. `CONTEXT.md` is a glossary, never a behavior specification.
- **Architecture rationale** lives in Architecture Decision Records under `docs/adr/`: system-wide decisions in the root `docs/adr/`, and decisions scoped to a single package in that package's `packages/<name>/docs/adr/`. Place each ADR with the narrowest scope that fully contains the decision.
- Contributors and AI agents **MUST NEVER** put package or application code in `docs/`.

Every package in `/packages/<name>` **MUST** follow this layout (based on the established repo convention):

```
package/
├── src/                  # All source code
├── __tests__/            # Test files
├── package.json
├── tsconfig.json         # must extend root tsconfig.json
├── jest.config.js        # Jest configuration
├── index.ts              # main entry point (or main.ts for standalone executables)
├── README.md             # recommended; required for new packages
├── CONTEXT.md            # optional; per-package glossary, authored lazily
└── docs/adr/             # optional; package-specific Architecture Decision Records
```

**Notes on build output:**
- Most packages compile to `dist/` (default). Packages with a custom build pipeline (e.g. `cli`, `features_renderer`) may use `build/` — the `main` field in `package.json` is the authoritative pointer.
- Built output directories (`dist/`, `build/`) must be gitignored.

## 5. Enforcement

- Use root configs, pre-commit hooks, and CI/CD as gatekeepers
- All AI agents **MUST** follow `AGENTS.md`
- Generated code **MUST** pass lint, type check, and tests before commit

### 5.1 Package-Scoped Validation Execution

- Unless explicitly requested otherwise, contributors and AI agents **MUST** execute linting and testing only in the specific package being changed.
- Global or repository-wide lint and test runs **MUST NOT** be used by default; they are allowed only when explicitly requested, or when a package `RULES.md` requires them for that package.
- Running validation only at the repository root does not satisfy the package-scoped validation requirement.
- When a package contains a `RULES.md`, its lint and test execution requirements **MUST** be followed exactly as written.
- Package-specific `RULES.md` files **MAY** impose stricter requirements, including mandatory environment variables, required flags, sequential execution, package-specific command flows, or other execution constraints. Those stricter requirements **MUST** be treated as binding for that package.
- If a package does not define specific lint or test execution rules in its `RULES.md`, the required default is:
  - run lint from the package directory with `npm run lint`
  - run tests from the package directory with `export ORG=firestartr-test` and `npm test -- --runInBand`
- If a package without specific rules requires a single test run, the required default flow is:

```sh
export ORG=firestartr-test
npm test -- <path of the test>
```

### 5.2 Package Scope Protection

- Unless explicitly requested otherwise, contributors and AI agents **MUST NOT** modify machinery files.
- Machinery files include `package.json`, `tsconfig.json`, `jest.config.js`, ESLint configuration, Prettier configuration, workspace settings, CI files, and similar tooling or repository-infrastructure files.
- This prohibition applies both to shared repository machinery and to machinery files inside the target package.
- Such files **MAY** be changed only when the user explicitly requests that kind of change, or when the change is strictly necessary for the requested work and no compliant package-local code-only solution exists.
- Changes to shared machinery outside the target package **MUST NOT** be made without explicit user request or review approval.

## 6. Governance

- This `CONSTITUTION.md` file **MUST** always remain in the repository root
- Any change to this Constitution requires a Pull Request + review


## 7. Rules Hierarchy and Precedence

All rules within this repository follow a strict hierarchy of precedence. In case of any conflict or ambiguity, the higher-level rule **always prevails**.

### 7.1 Precedence Order (Highest to Lowest)

The following order of precedence **MUST** be respected by all contributors and AI agents:

| Rank | Rule Type                        | Scope          | Precedence                                                                 |
|------|----------------------------------|----------------|----------------------------------------------------------------------------|
| 1    | **CONSTITUTION.md**              | Repository-wide | **Supreme law**. Non-negotiable. All other rules derive from and must comply with it. |
| 2    | **AGENTS.md**                    | AI-specific    | Operational rules for all AI agents. Must extend the Constitution and never contradict it. |
| 3    | **Package-specific rules**       | Package-level  | Local rules **MAY** impose stricter requirements, but **MUST NOT** contradict, weaken, or override any higher-level rule. |
| 4    | **Skills**                       | Task-level     | Agent skills under `.agents/skills/`. Must fully comply with all higher levels. |

### 7.2 Key Principles

1. **High-level rules have absolute precedence**  
   Global rules defined in `CONSTITUTION.md` take precedence over all local rules and skills.

2. **Local rules may be stricter, but never weaker**  
   Package-specific rules may add additional or stricter requirements within their scope. They **SHALL NOT** reduce, relax, or conflict with any rule from a higher level.

3. **Special rules apply in addition to general rules**  
   When a more specific rule exists and is stricter, it applies **in addition to** (not instead of) the higher-level rules.

4. **AI agents MUST resolve conflicts using this hierarchy**  
   All AI agents **MUST** explicitly follow this precedence order when generating code, making decisions, or proposing changes.

### 7.3 Conflict Resolution

In the event of a conflict between rules:
- The higher-ranked rule in the table above **MUST** be followed.
- The conflicting lower-ranked rule **MUST** be disregarded for that specific case.
- Any ambiguity **MUST** be escalated via Pull Request for official clarification in this Constitution.


---

**This Constitution is the supreme law of the project.**

It can be extended in future iterations while preserving these core rules.

All contributors and AI agents are bound by it.


See `AGENTS.md` for how AI assistants must handle them.
