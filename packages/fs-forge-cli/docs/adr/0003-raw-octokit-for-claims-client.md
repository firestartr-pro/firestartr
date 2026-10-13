# ADR 0003: Raw Octokit for the claims client

**Status**: Accepted  
**Date**: 2026-07-21  
**Parent issues**: [#2347](https://github.com/prefapp/gitops-k8s/issues/2347), [#2398](https://github.com/prefapp/gitops-k8s/issues/2398)

## Context

The fs-forge-cli package needs a module that reads from and writes to a
remote claims repo — fetching the claims map, downloading claim files, creating
branches, committing YAML, and dispatching the provision workflow. Today that
is `src/claims/claimsRepo.ts` over the Octokit adapter in
`src/github/octokitApi.ts`.

The repo convention says "use `packages/github` whenever possible."
`packages/github` provides two auth paths:

- **GitHub App** (`getOctokitForOrg(org)`): requires `GITHUB_APP_ID`,
  `GITHUB_APP_PEM_FILE`, and resolves an installation token per call. This is
  the path every other consumer (operator, CI workflows) uses.
- **PAT** (`getOctokitFromPat(envVar)`): uses `process.env[envVar]` as a
  static token.

Both paths create a fresh Octokit instance on every function call, resolving
auth each time. A `--commit` flow makes 6+ sequential API calls.

## Decision

fs-forge-cli's GitHub adapter (`src/github/octokitApi.ts`) will **not** use
`packages/github`. Instead it will:

1. Depend directly on `@octokit/rest`
2. Create a single Octokit instance from `process.env.GITHUB_TOKEN`
3. Wrap the needed API interactions inline (get content with base64 decode,
   create-or-update file, create branch from default branch SHA, dispatch
   workflow)
4. Accept an optional pre-configured Octokit in its constructor for testing

## Rationale

- **No PEM on workstations.** The GitHub App path requires every developer
  running fs-forge to have `GITHUB_APP_PEM_FILE` — a private key — on their
  machine. Distributing and rotating a private key for a CLI tool is a
  security and operational burden. A PAT is disposable, scoped, and natural
  for CLI use.
- **Single authenticated session.** One Octokit instance reused across 6+
  calls in a `--commit` flow avoids redundant token resolution and HTTP
  connection overhead.
- **No `catalog_common` coupling.** `packages/github`'s ambient auth path
  depends on `catalog_common`'s environment helpers. fscli currently has no
  such dependency.
- **Simple testing.** An Octokit can be mocked at the constructor level:
  `new Octokit({ auth: 'fake', request: mockFn })`. `packages/github`'s
  functions do not consistently support octokit injection.
- **Small surface.** The wrappers fscli needs (base64 decode, SHA-aware
  create-or-update, branch-from-default) are each ~5–10 lines. Importing all
  of `packages/github` for these is disproportionate.

## Consequences

- `@octokit/rest` must be added to `packages/fs-forge-cli/package.json`
- The GitHub port (`src/github/api.ts`) and its Octokit adapter are the single
  source of truth for fs-forge's GitHub API surface — any new GitHub interaction
  in fscli goes through them
- `packages/github`'s auth-switch logic (PAT for `prefapp/features`, GitHub
  App for everything else) is bypassed. fscli uses `GITHUB_TOKEN` for all
  requests, including to `prefapp/features` if it ever needs that repo
- Maintenance: changes to the API wrappers (e.g. a new content API endpoint)
  must be updated in `src/github/octokitApi.ts` and are not inherited from
  `packages/github`

## Alternatives considered

- **Route through `packages/github`'s default export.** Would force every
  fscli user to configure GitHub App env vars. Rejected due to PEM
  distribution burden.
- **Route through `withProfile('ambient')`.** Would still require the same
  env vars plus a `createProfile` call before use. Same PEM problem.
- **Hybrid: raw Octokit for auth, `packages/github` for utility wrappers.**
  Would couple fscli to `packages/github` for trivial wrappers while keeping
  the PAT auth path. Unnecessary dependency.
