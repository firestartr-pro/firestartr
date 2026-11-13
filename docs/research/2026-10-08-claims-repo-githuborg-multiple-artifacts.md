# Research: `claims_repo` githuborg / org-settings handling — gaps, dead code, and pending artifacts

Date: 2026-10-08 · Sources: primary only (`prefapp/features` clone at `/tmp/opencode/features`,
`firestartr` at `/home/firestartr/firestartr`, `gh issue view`). No repos edited, no issues opened.

**Problem statement.** A single githuborg-type claim (`OrgSettingsClaim`) legitimately renders
**multiple CR artifacts** from the renderer (`FirestartrGithubOrganizationSettings` +
`FirestartrGithubOrganizationVariableSection`), but the claim-kind → CR-kind mapping that decides
which artifacts get hydrated/deleted is not produced by the renderer — it is **hard-coded and
duplicated**: two inline copies inside the `claims_repo` hydrate/delete workflows, a third copy in
`firestartr`'s e2e taxonomy, plus copy in docs. Those hard-coded copies contain a claim kind the
renderer does not support (`GitHubOrgClaim`), a claim kind (`OrgSettingsClaim`) that is missing
from the provision/unprovision routing, and a CR kind (`FirestartrGithubOrganizationSecretSection`)
that the platform **has not implemented yet** — the workflows were written ahead of the platform,
anticipating the org-level twin of the already-implemented
`FirestartrGithubRepositorySecretsSection`. So the same mapping is simultaneously over-specified
(a not-yet-existing kind with two competing spellings, and a dead claim kind) and under-specified
(a missing routing entry) in different workflows of the same feature.

## Findings — what is lacking

1. **`GitHubOrgClaim` is unsupported by the renderer, yet selectable everywhere in the feature.**
   Zero occurrences of `githuborgclaim` (case-insensitive) in `firestartr`. Its schema lookup
   `claims['GitHubOrgClaimSchema']` is `undefined`, and `validateClaim`'s default parameter makes
   that fall back to the generic `ClaimEnvelope` schema — so it is *not* a hard failure: the claim
   loads, then `sortKinds`' fixed kind list filters it out and the render switch never sees it →
   **zero CRs rendered, no error** (silently dropped). `InitializerClaimRef.applicableKinds` also
   omits it, so it could never carry a `claim-ref` annotation anyway. In the hydrate workflow this
   surfaces as "No CR files found / render failed" (`hydrate-github-claim.yaml:217-239`).
   Verdict: **silently ignored, not a hard failure, not supported.**
2. **`OrgSettingsClaim` missing from provision/unprovision routing.** `provision-claim.yaml:178`
   and `unprovision-claim.yaml:123,155` route `GitHubOrgClaim` but not `OrgSettingsClaim`; both
   fall to the `*` branch → hard error `Unsupported claim type` (`provision-claim.yaml:203`) /
   `Unknown claim type` (`unprovision-claim.yaml:141`). Meanwhile `auto-hydrate.yaml:294`,
   `pr-verify.yaml:125-126`, the hydrate/delete maps and `config.yaml:30` all include it — and
   `config.yaml:30` puts `OrgSettingsClaim` in `GITHUB_CLAIM_KIND_LIST`, i.e. every kind dropdown.
3. **The tests pin the incomplete lists.** `__tests__/provision-claim.test.js:30` and
   `__tests__/unprovision-claim.test.js:30,54` assert the case patterns **without**
   `OrgSettingsClaim`, so fixing the routing requires updating the tests too. No test in the
   feature covers `hydrate-github-claim.yaml`/`delete-github-claim.yaml` maps at all (only
   `delete-result-contract`, `generate-claims-map`, `provision-claim`, `unprovision-claim` exist).
4. **No renderer-exported claim→CR manifest.** The multiplicity originates only in renderer code
   (`extraCharts` in `claims-render.ts:502-546` and `repositoryChart.ts:310-322`). There is no
   machine-readable export: `packages/cdk8s_renderer/scripts/` holds only the two schema exporters,
   `package.json` has no such script, and the CLI subcommands are `render | compare | render-plan |
   generate-claims-map` (`cli/src/subcommands/cdk8s_renderer-subcommands.ts:9-13`) — where
   `generateClaimsMap` maps claim-ref → *file path + refs* (`claimUtils.ts:196-214`), not CR kinds.
   Consequence: the mapping exists as 2 inline workflow copies + 1 e2e copy + docs prose.
5. **Docs/schema drift.** `templates/docs/README.md` lists `GitHubOrgClaim` (line 38) but has no
   `OrgSettingsClaim` bullet, although the platform documents it
   (`docs/public/providers/github/org-settings.md:1`) and `fs-forge-cli` has an `orgsettings` kind
   (`kinds.ts:24`). In-repo `docs/claims/claims.schema.json` contains **no** `OrgSettings` at all,
   although a fresh `npm run export-schemas` would include it (`schemas/index.ts:12,51`); the file
   was last regenerated in the initial OSS import commit. Separately,
   `scripts/schema-npm-producer.ts:61-71` hard-codes its `CLAIM_KINDS` list **without**
   `OrgSettingsClaim` → the published `@firestartr/firestartr-claims_schemas` package omits it too.

## Findings — pending, not dead (do not remove)

1. **`FirestartrGithubOrganizationSecretSection` is not implemented *yet* — it is forward-looking,
   not dead.** The platform has no class for it in `imports/firestartr.dev.ts` (only
   `…OrganizationSettings` :903 and `…OrganizationVariableSection` :1490) and no chart — but the
   **repo-level twin is fully implemented**: `FirestartrGithubRepositorySecretsSection` has its CRD
   (`packages/k8s/src/crds/crd-firestartr-github-repository-secrets-section.yaml`), chart
   (`charts/github/RepoSecretsSectionChart.ts`), provisioner entity
   (`gh_provisioner/src/entities/grss`), e2e tests, taxonomy entry
   (`claim-taxonomy.ts:38`) and a hydrated state-repo CR
   (`.tmp_dir/state-github/FirestartrGithubRepositorySecretsSection.*.yaml`). #1215's own table
   maps `ComponentClaim` → `FirestartrGithubRepositorySecretsSection`. The workflows'
   `OrgSettingsClaim` → three-CR entries (`hydrate-github-claim.yaml:154`,
   `delete-github-claim.yaml:89`, `excludedKinds` `:109`) are the **anticipated org-level
   counterpart** (org Actions secrets), written ahead of the platform. They must be *kept*, not
   removed, so hydration picks the artifact up automatically when it lands.
   **Open:** the spelling must be settled *before* the platform implements it — the workflows say
   `…SecretSection` while the feature's own CHANGELOG (#1216, `CHANGELOG.md:68`) says
   `…SecretsSection` (with an "s", matching the repo-level CRD name `…SecretsSection`); if the
   future CRD follows the repo-level naming, every allowlist entry misses it.
2. **The `-secret-section` suffix branch is the matching hook for that pending artifact** —
   `hydrate-github-claim.yaml:181`, `delete-github-claim.yaml:125`. The renderer emits zero
   `-secret-section` claim-refs *today* simply because the artifact does not exist yet; whether the
   future CR's `claim-ref` will actually be suffixed (or stamped with the plain claim name, as the
   repo-level `RepoSecretsSectionChart` does via `getAnnotationsFromRepo(... 'claim-ref')`) is a
   contract the platform must define when it implements the kind. Not removable on evidence —
   unverifiable until then.

## Findings — what is not needed

1. **The `-variable-section` suffix branch matches nothing from the current renderer.** The
   renderer uses `${claim.name}-variable-section` only as the *refresolver key* for the extra chart
   (`claims-render.ts:541` → `refresolver/index.ts:19-28`); the CR's actual
   `firestartr.dev/claim-ref` annotation is stamped by `InitializerClaimRef` with the plain claim
   name (`claimRef.ts:31-41`), and the renderer's own test asserts
   `OrgSettingsClaim/github_org_settings` (unsuffixed) for the VariableSection CR
   (`__tests__/github_org_variable_section.renderer.test.ts:48-51`). Plain equality already matches
   both org CRs (both carry `OrgSettingsClaim/<name>`); kind filtering alone separates them. Same
   two occurrences as above (hydrate:181, delete:125).
2. **`GitHubOrgClaim` workflow entries cannot match any rendered CR** (per gap 1): hydrate:153,161;
   delete:88,96; provision:178; unprovision:123,155; pr-verify:125; auto-hydrate:294; docs:38;
   config:30; tests:30/30/54 (14 lines / 10 files). They are selectable but always render nothing.
3. **Two divergent "find CR by claim name" implementations.** The github workflows inline their own
   JS (`hydrate-github-claim.yaml:124-208`, `delete-github-claim.yaml:62-170`) while
   `hydrate-tfworkspace-claim.yaml:132`, `hydrate-secrets-claim.yaml:127`,
   `delete-tfworkspace-claim.yaml:75`, `delete-secrets-claim.yaml:68` call the shared
   `.github/scripts/find-and-copy-cr-by-claim-name.js` / `find-and-delete-cr-by-claim-name.js`
   (which take the kind allowlist as *arguments* and contain variant handling the inline copies
   lack). The kind maps + suffix hacks exist only in the inline copies — grep confirms the github
   workflows reference only `check-real-changes.sh` and `write-delete-result.sh`.
4. **e2e taxonomy diverges from the workflow maps:** `claim-taxonomy.ts:24-47` maps
   `OrgSettingsClaim` → **two** CR kinds (no SecretSection — expected: the artifact is pending) and has **no** `GitHubOrgClaim` key
   (`getRelatedCrKindsForClaimKind` throws for unknown kinds, lines 77-82).

## Evidence

- `prefapp/features:` maps defined twice — `templates/.github/workflows/hydrate-github-claim.yaml:144,156` and `delete-github-claim.yaml:79,91`; used at `hydrate…:182,192,203` and `delete…:126,148,159`.
- `prefapp/features:` 3-CR list `[…Settings, …VariableSection, …SecretSection]` — `hydrate…:154`, `delete…:89`; `excludedKinds` w/ `…SecretSection` — `delete…:105-110`; suffix hack — `hydrate…:181`, `delete…:125` (only 2 occurrences feature-wide).
- `prefapp/features:` routing — `provision-claim.yaml:178` (error `:203`), `unprovision-claim.yaml:123,155` (error `:141`), vs `auto-hydrate.yaml:294`, `pr-verify.yaml:125-126`; kind dropdown `config.yaml:30`; tests `__tests__/provision-claim.test.js:30`, `__tests__/unprovision-claim.test.js:30,54`.
- `prefapp/features:` shared-script users `hydrate-tfworkspace-claim.yaml:132`, `hydrate-secrets-claim.yaml:127`, `delete-tfworkspace-claim.yaml:75`, `delete-secrets-claim.yaml:68`; shared scripts `templates/.github/scripts/find-and-copy-cr-by-claim-name.js:1-89`, `find-and-delete-cr-by-claim-name.js:1-97`; github workflows use neither (grep).
- `prefapp/features:` docs `templates/docs/README.md:34-38` (GitHubOrgClaim at 38; `README.md` is a symlink to it); `CHANGELOG.md:68` (`…SecretsSection`, #1216).
- `firestartr:` kind switch fixed list `packages/cdk8s_renderer/src/renderer/claims-render.ts:56-70` (has `OrgSettingsClaim`, no `GitHubOrgClaim`); filter `src/refsSorter/refsSorter.ts:15-20` + `src/renderer/claims-sorter.ts:4-14`; switch `claims-render.ts:238`, OrgSettings case `:502-546`, extra-chart key `:541`, unreachable `default` `:548-551`; extraCharts merged `:144-150`.
- `firestartr:` validation fallback `src/claims/base/validation.ts:20-23,28-35`; undefined lookup `src/loader/lazy_loader.ts:143-146` and `src/collections/claims.ts:51-55`; schema registry `src/claims/base/index.ts:44-55` (no `GitHubOrgClaimSchema`); initializer skip-on-mismatch `src/loader/loader.ts:192-198`; applicableKinds `src/initializers/claimRef.ts:4-11`.
- `firestartr:` no org SecretSection CR *yet*: `imports/firestartr.dev.ts:903,1490,4050`; grep over the repo (excl. node_modules/.git): `SecretSection` → 0 matches, `OrganizationSecret` → 0 matches, `secret-section` → 0 matches; `SecretsSection` → only `FirestartrGithubRepositorySecretsSection` (repo-level, fully implemented: CRD `packages/k8s/src/crds/crd-firestartr-github-repository-secrets-section.yaml`, chart `charts/github/RepoSecretsSectionChart.ts`, provisioner `gh_provisioner/src/entities/grss`, e2e `__tests__/github/component-repo-secrets-render-apply.test.ts`, `imports/firestartr.dev.ts:4050`, `crs_status_service/src/informer.ts:52`) — the org-level counterpart is pending, which is why the workflows already allowlist it.
- `firestartr:` component multiplicity `src/charts/github/repositoryChart.ts:310-322`; e2e copy `packages/e2e/src/claim-taxonomy.ts:24-47,77-82`; unsuffixed claim-ref asserted at `packages/cdk8s_renderer/__tests__/github_org_variable_section.renderer.test.ts:48-51`.
- `firestartr:` no exportable claim→CR manifest: `packages/cdk8s_renderer/scripts/{schema-exporter.ts,schema-npm-producer.ts}`, `packages/cdk8s_renderer/package.json` scripts, `packages/cli/src/subcommands/cdk8s_renderer-subcommands.ts:9-13`, `src/utils/claimUtils.ts:196-214`.
- `firestartr:` schema drift: `src/claims/base/schemas/index.ts:12,51` exports OrgSettings but `docs/claims/claims.schema.json` has no `OrgSettings` string (regenerated by `.github/workflows/promote_claims_schema.yaml:76`, `Makefile:91-92`); `scripts/schema-npm-producer.ts:61-71`; `git log -- docs/claims/claims.schema.json` → only `61a50f9 feat!: new OSS version (#9)`.
- `firestartr:` platform support for OrgSettings: `docs/public/providers/github/org-settings.md:1`, `packages/fs-forge-cli/src/claims/kinds.ts:24`, singleton validations `src/validations/githubOrgSettings.ts:13-42`, `githubOrgVariableSection.ts:12-52`.

## Already fixed elsewhere

- **#1215 (closed)** — "`claims_repo` add OrgSettingsClaim to hydration workflow kind options". Already fixed by **#1216 (merged, CHANGELOG `claims_repo` 2.8.0)**: added `OrgSettingsClaim` to dispatch kind options, auto-hydrate matrix, both inline maps, added `FirestartrGithubOrganizationVariableSection` to the allowlist, added `-variable-section` suffix matching "for defensive coverage", kept `GitHubOrgClaim` "for backwards compatibility". **Do not re-file that.**
- **#1311 (closed)** — auto-hydrate dispatched an undeclared `kind` input to tfworkspace/secrets hydrate workflows (fixed).
- Related **open** issues: **#1203** (extract claims_repo workflow machinery into Node CLIs), **#1204** (audit of duplicated workflow logic — already inventories the 3 find-CR implementations, incl. the github inline copies), **#1261** (auto-merge flag opens 2 PRs), **#1315** (unprovision policy), **#494** (multiple claim names in hydrate). Searches `OrgSettingsClaim` / `GitHubOrgClaim` / `hydrate githuborg` returned only 1215, 1311, 1190 (all closed); no open issue covers the provision/unprovision routing gap, the pending org SecretSection kind's naming/contract, or the missing claim→CR manifest.

## Open questions

1. **Why the suffix branches exist.** #1215 asserted the VariableSection CR's `claim-ref` is `OrgSettingsClaim/<name>-variable-section`; the current renderer test asserts it is unsuffixed. Both repos' histories start at a squashed import (`61a50f9`), so the origin cannot be verified from local git — was an older renderer emitting suffixed refs, or was #1215's premise wrong?
2. **Is `GitHubOrgClaim` meant to be a legacy alias to remove, or a kind to implement?** Workflows/docs keep it "for backwards compatibility", but the renderer can never produce a CR for it — a product decision, not a code defect.
3. **Is the stale in-repo `docs/claims/claims.schema.json` consumed anywhere**, or only the CI-regenerated pro-docs copy (`promote_claims_schema.yaml:76`)?
4. **Scope check:** `packages/crs_status_service/src/informer.ts:47-57` maps `githuborganizationsettings` but not `githuborganizationvariablesections` — out of this issue's scope, but adjacent (may be handled elsewhere or may be a real gap).
5. **Should `schema-npm-producer.ts`'s `CLAIM_KINDS` be derived from `schemas/index.ts`** instead of a fourth hand-maintained list? (Likely belongs with #1203/#1204.)
6. **What will the pending org secrets artifact be called, and how will its `claim-ref` be stamped?** Workflows say `FirestartrGithubOrganizationSecretSection` + `-secret-section` suffix; CHANGELOG says `…SecretsSection`; the repo-level twin is `…SecretsSection` stamped with the *plain* claim-ref. Settle the name and the claim-ref contract before the platform implements the kind, or the allowlist/suffix entries will silently miss it.
