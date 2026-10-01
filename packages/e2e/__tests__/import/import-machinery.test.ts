import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import common from 'catalog_common';
import github from 'github';
import { runImporter } from 'importer';
import { AllowedProviders } from 'render';

import {
  initE2e,
  cleanupRenderedArtifacts,
  CleanupRunner,
  type E2EApi,
} from '../..';
import {
  BACKEND_PROVIDER_NAME,
  GITHUB_PROVIDER_NAME,
  LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS,
  WAIT_FOR_CR_TIMEOUT_SECONDS,
} from '../../src/test-constants';
import { buildClaimRef } from '../../src/claim-taxonomy';
import {
  findRenderedCrPaths,
  patchResourceSpecContext,
  readK8sResource,
} from '../../src/cr-finder';
import { hasAnnotation } from '../../src/k8s/annotations';
import { PROVIDER_CONFIGS } from '../../src/test-constants';

import type { K8sResource } from '../../src/k8s/types';

// ----- Constants -----

const IMPORT_ANNOTATION = common.generic.getFirestartrAnnotation('import');
const CLAIM_REF_ANNOTATION =
  common.generic.getFirestartrAnnotation('claim-ref');
const EXTERNAL_NAME_ANNOTATION =
  common.generic.getFirestartrAnnotation('external-name');

const SUITE_PREFIX = 'import-machinery';

// Resource names are built from the suite prefix to avoid collisions.
const TEAM_NAME = `${SUITE_PREFIX}-e2e-team`;
const REPO_NAME = `${SUITE_PREFIX}-e2e-repo`;

// User: prefer env var; fallback resolved at runtime from org members.
const ENV_IMPORT_USER = process.env.E2E_IMPORT_USER;

// Temp dirs to clean up.
const tempDirs: string[] = [];

// ----- Helpers -----

async function createTempDir(label: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `e2e-${label}-`));
  tempDirs.push(dir);
  return dir;
}

async function getOctokit(org: string) {
  return github.getOctokitForOrg(org);
}

async function createTeam(org: string, name: string): Promise<void> {
  const octokit = await getOctokit(org);
  try {
    await octokit.rest.teams.getByName({ org, team_slug: name });
    // Already exists, skip
  } catch {
    await octokit.rest.teams.create({ org, name, privacy: 'closed' });
  }
}

async function createRepo(org: string, name: string): Promise<void> {
  const octokit = await getOctokit(org);
  try {
    await octokit.rest.repos.get({ owner: org, repo: name });
    // Already exists, skip
  } catch {
    await octokit.rest.repos.createInOrg({
      org,
      name,
      auto_init: true,
      visibility: 'private',
    });
  }
}

async function resolveImportUser(org: string): Promise<string> {
  if (ENV_IMPORT_USER) return ENV_IMPORT_USER;
  const octokit = await getOctokit(org);
  const members = await octokit.rest.orgs.listMembers({
    org,
    per_page: 1,
  });
  const first = members.data[0];
  if (!first) {
    throw new Error(
      `No org members found for ${org}. Set E2E_IMPORT_USER to specify one.`,
    );
  }
  return first.login;
}

async function deleteTeamSafe(org: string, name: string): Promise<void> {
  try {
    const octokit = await getOctokit(org);
    await octokit.rest.teams.deleteInOrg({ org, team_slug: name });
  } catch {
    // tolerate not-found
  }
}

async function deleteRepoSafe(org: string, name: string): Promise<void> {
  try {
    const octokit = await getOctokit(org);
    await octokit.rest.repos.delete({ owner: org, repo: name });
  } catch {
    // tolerate not-found
  }
}

function getExpectedClaimFileName(claimName: string): string {
  return `${claimName.toLowerCase()}.yaml`;
}

function formatCleanupError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function expectClaimFile(claimFiles: string[], claimName: string): void {
  expect(claimFiles).toContain(getExpectedClaimFileName(claimName));
}

function getFirestartrTfStateKey(resource: K8sResource): string {
  const spec = resource.spec as
    | { firestartr?: { tfStateKey?: unknown } }
    | undefined;
  const tfStateKey = spec?.firestartr?.tfStateKey;

  if (typeof tfStateKey !== 'string' || tfStateKey.length === 0) {
    throw new Error(
      `Missing spec.firestartr.tfStateKey in ${resource.kind}/${resource.metadata?.name ?? '<unknown>'}`,
    );
  }

  return tfStateKey;
}

function expectRenderedCrMetadata(
  resource: K8sResource,
  expected: {
    kind: string;
    nameBase: string;
    claimRef: string;
    externalName: string;
  },
): void {
  expect(resource.kind).toBe(expected.kind);
  expect(resource.metadata?.name).toBe(
    `${expected.nameBase}-${getFirestartrTfStateKey(resource)}`,
  );
  expect(resource.metadata?.annotations?.[CLAIM_REF_ANNOTATION]).toBe(
    expected.claimRef,
  );
  expect(resource.metadata?.annotations?.[EXTERNAL_NAME_ANNOTATION]).toBe(
    expected.externalName,
  );
}

function expectNoUnexpectedRenderedCrFiles(
  crsPath: string,
  expectedCrFiles: string[],
): void {
  const allCrFiles = common.io
    .getFileListRecursively(crsPath, [], ['.yaml', '.yml'])
    .sort();
  const expected = new Set(expectedCrFiles);
  const unexpected = allCrFiles.filter((crFile) => !expected.has(crFile));

  expect(unexpected).toEqual([]);
}

// ----- Suite -----

describe('Import machinery E2E', () => {
  let client: E2EApi;
  let org: string;
  let importUser: string;

  // Importer output paths
  let claimsPath: string;
  let crsPath: string;
  let configPath: string;

  // Tracks whether CR-based cleanup is safe
  let crCleanupSafe = false;
  // Collected CR paths for assertions
  const appliedCrPaths: string[] = [];
  // CRs safe to delete after rehydration. Existing org membership imports are
  // intentionally excluded because deleting ownership of a real org member can
  // remove that member from the GitHub org.
  const cleanupCrPaths: string[] = [];

  beforeAll(async () => {
    client = await initE2e(undefined, undefined, {
      namePrefix: SUITE_PREFIX,
    });
    org = client.getOrg();
    importUser = await resolveImportUser(org);

    // Prepare temp directories for importer output
    claimsPath = await createTempDir('import-claims');
    crsPath = await createTempDir('import-crs');
    configPath = await createTempDir('import-config');

    // Write minimal importer config defaults needed for rendering
    const resourcesDir = path.join(configPath, 'resources');
    await fs.mkdir(resourcesDir, { recursive: true });

    const claimDefaults = {
      ComponentClaim: {
        owner: `group:${TEAM_NAME}`,
      },
      GroupClaim: {
        providers: {
          github: {
            privacy: 'closed',
          },
        },
      },
    };

    const groupDefault = {
      name: 'group_base',
      apiVersion: 'firestartr.dev/v1',
      kind: 'FirestartrGithubGroup',
      defaultValues: {
        context: {
          backend: {
            ref: {
              kind: 'FirestartrProviderConfig',
              name: BACKEND_PROVIDER_NAME,
            },
          },
          provider: {
            ref: {
              kind: 'FirestartrProviderConfig',
              name: GITHUB_PROVIDER_NAME,
            },
          },
        },
        org,
      },
    };

    const repoDefault = {
      name: 'repo_base',
      apiVersion: 'firestartr.dev/v1',
      kind: 'FirestartrGithubRepository',
      defaultValues: {
        context: {
          backend: {
            ref: {
              kind: 'FirestartrProviderConfig',
              name: BACKEND_PROVIDER_NAME,
            },
          },
          provider: {
            ref: {
              kind: 'FirestartrProviderConfig',
              name: GITHUB_PROVIDER_NAME,
            },
          },
        },
        org,
        firestartr: {
          technology: { stack: 'node', version: '14' },
          type: 'service',
          lifecycle: 'production',
          system: `${org}-system`,
        },
        repo: {
          description: '',
          allowMergeCommit: true,
          allowSquashMerge: true,
          allowRebaseMerge: true,
          allowAutoMerge: false,
          deleteBranchOnMerge: false,
          autoInit: true,
          archiveOnDestroy: false,
          allowUpdateBranch: false,
          hasIssues: true,
          visibility: 'private',
          defaultBranch: 'main',
          codeowners: '',
        },
        actions: {
          oidc: { useDefault: true, includeClaimKeys: [] },
        },
      },
    };

    const memberDefault = {
      name: 'membership_base',
      apiVersion: 'firestartr.dev/v1',
      kind: 'FirestartrGithubMembership',
      defaultValues: {
        context: {
          backend: {
            ref: {
              kind: 'FirestartrProviderConfig',
              name: BACKEND_PROVIDER_NAME,
            },
          },
          provider: {
            ref: {
              kind: 'FirestartrProviderConfig',
              name: GITHUB_PROVIDER_NAME,
            },
          },
        },
        org,
      },
    };

    await fs.writeFile(
      path.join(resourcesDir, 'claims_defaults.yaml'),
      common.io.toYaml(claimDefaults),
      'utf-8',
    );
    await fs.writeFile(
      path.join(resourcesDir, 'defaults_github_group.yaml'),
      common.io.toYaml(groupDefault),
      'utf-8',
    );
    await fs.writeFile(
      path.join(resourcesDir, 'defaults_github_repository.yaml'),
      common.io.toYaml(repoDefault),
      'utf-8',
    );
    await fs.writeFile(
      path.join(resourcesDir, 'defaults_github_membership.yaml'),
      common.io.toYaml(memberDefault),
      'utf-8',
    );

    // Pre-clean stale resources
    await deleteTeamSafe(org, TEAM_NAME);
    await deleteRepoSafe(org, REPO_NAME);

    // Create source GitHub resources for import
    await createTeam(org, TEAM_NAME);
    await createRepo(org, REPO_NAME);
  }, LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS);

  afterAll(async () => {
    const runner = new CleanupRunner();
    let directGithubCleanupRequired = !crCleanupSafe;

    if (crCleanupSafe) {
      await runner.run('delete-crs', async () => {
        const crCleanupErrors: string[] = [];

        for (const crPath of [...cleanupCrPaths].reverse()) {
          try {
            await client.k8s.deleteCr(crPath, WAIT_FOR_CR_TIMEOUT_SECONDS);
          } catch (err) {
            crCleanupErrors.push(`${crPath}: ${formatCleanupError(err)}`);
          }
        }

        if (crCleanupErrors.length > 0) {
          directGithubCleanupRequired = true;
          throw new Error(crCleanupErrors.join('\n'));
        }
      });
    }

    if (directGithubCleanupRequired) {
      await runner.run('delete-team', () => deleteTeamSafe(org, TEAM_NAME));
      await runner.run('delete-repo', () => deleteRepoSafe(org, REPO_NAME));
    }

    // Clean rendered artifacts and temp dirs
    await runner.run('cleanup-rendered', () =>
      cleanupRenderedArtifacts(client),
    );
    for (const dir of tempDirs) {
      await runner.run(`rm-temp:${dir}`, () =>
        fs.rm(dir, { recursive: true, force: true }),
      );
    }

    runner.warnOnErrors('import-machinery-afterall');
  }, LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS);

  it(
    'imports group, user, and component, then renders, applies, rehydrates, and validates',
    async () => {
      // ---- Step 1: Run importer with name filters ----
      await runImporter(
        true, // force
        true, // skipPlan
        claimsPath,
        crsPath,
        configPath,
        path.join(configPath, 'resources'), // claimsDefaultsPath
        org,
        [
          `gh-group,NAME=${TEAM_NAME}`,
          `gh-repo,NAME=${REPO_NAME}`,
          `gh-members,NAME=${importUser}`,
        ],
        AllowedProviders.github,
        false, // needsReimport
      );

      // ---- Step 2: Assert expected claim files exist ----
      const groupClaimsDir = path.join(claimsPath, 'groups');
      const usersClaimsDir = path.join(claimsPath, 'users');
      const componentsClaimsDir = path.join(claimsPath, 'components');
      const userClaimName = importUser.toLowerCase();

      const groupClaimFiles = await fs.readdir(groupClaimsDir).catch(() => []);
      const userClaimFiles = await fs.readdir(usersClaimsDir).catch(() => []);
      const componentClaimFiles = await fs
        .readdir(componentsClaimsDir)
        .catch(() => []);

      expectClaimFile(groupClaimFiles, TEAM_NAME);
      expectClaimFile(userClaimFiles, userClaimName);
      expectClaimFile(componentClaimFiles, REPO_NAME);

      // ---- Step 3: Assert rendered CR metadata for expected claims ----
      const groupClaimRef = buildClaimRef('GroupClaim', TEAM_NAME);
      const userClaimRef = buildClaimRef('UserClaim', userClaimName);
      const componentClaimRef = buildClaimRef('ComponentClaim', REPO_NAME);
      const groupCrPaths = await findRenderedCrPaths(
        crsPath,
        'GroupClaim',
        groupClaimRef,
      );
      const userCrPaths = await findRenderedCrPaths(
        crsPath,
        'UserClaim',
        userClaimRef,
      );
      const componentCrPaths = await findRenderedCrPaths(
        crsPath,
        'ComponentClaim',
        componentClaimRef,
      );
      const renderedCrFiles = [
        ...userCrPaths,
        ...groupCrPaths,
        ...componentCrPaths,
      ];

      expectNoUnexpectedRenderedCrFiles(crsPath, renderedCrFiles);

      expectRenderedCrMetadata(await readK8sResource(groupCrPaths[0]), {
        kind: 'FirestartrGithubGroup',
        nameBase: TEAM_NAME,
        claimRef: groupClaimRef,
        externalName: TEAM_NAME,
      });
      expectRenderedCrMetadata(await readK8sResource(userCrPaths[0]), {
        kind: 'FirestartrGithubMembership',
        nameBase: userClaimName,
        claimRef: userClaimRef,
        externalName: importUser,
      });
      expectRenderedCrMetadata(await readK8sResource(componentCrPaths[0]), {
        kind: 'FirestartrGithubRepository',
        nameBase: REPO_NAME,
        claimRef: componentClaimRef,
        externalName: REPO_NAME,
      });

      // ---- Step 4: Patch provider context and apply CRs ----
      // Apply in order: membership, group, then repository
      const applyOrder = [
        'FirestartrGithubMembership',
        'FirestartrGithubGroup',
        'FirestartrGithubRepository',
      ];

      const crsByKind = new Map<string, string[]>();
      for (const crFile of renderedCrFiles) {
        const content = await fs.readFile(crFile, 'utf-8');
        const resource = common.io.fromYaml(content) as {
          kind?: string;
        };
        if (!resource.kind) continue;
        if (!crsByKind.has(resource.kind)) crsByKind.set(resource.kind, []);
        crsByKind.get(resource.kind)!.push(crFile);
      }

      for (const kind of applyOrder) {
        const crFiles = crsByKind.get(kind) ?? [];
        for (const crFile of crFiles) {
          // Patch spec.context with e2e provider config refs
          await patchResourceSpecContext(crFile, {
            backend: { ref: PROVIDER_CONFIGS.backend },
            provider: { ref: PROVIDER_CONFIGS.github },
          });

          await client.k8s.applyCr(crFile);
          appliedCrPaths.push(crFile);
          if (kind !== 'FirestartrGithubMembership') {
            cleanupCrPaths.push(crFile);
          }
        }
      }

      // Also apply child CRs (features, secrets sections)
      const childKinds = [
        'FirestartrGithubRepositoryFeature',
        'FirestartrGithubRepositorySecretsSection',
      ];
      for (const kind of childKinds) {
        const crFiles = crsByKind.get(kind) ?? [];
        for (const crFile of crFiles) {
          await patchResourceSpecContext(crFile, {
            backend: { ref: PROVIDER_CONFIGS.backend },
            provider: { ref: PROVIDER_CONFIGS.github },
          });
          await client.k8s.applyCr(crFile);
          appliedCrPaths.push(crFile);
          cleanupCrPaths.push(crFile);
        }
      }

      // ---- Step 5: Wait for reconciliation ----
      for (const crPath of appliedCrPaths) {
        const result = await client.k8s.waitForCr(
          crPath,
          WAIT_FOR_CR_TIMEOUT_SECONDS,
        );
        expect(result).toBeDefined();
      }

      // ---- Step 6: Rehydrate — remove import annotation ----
      for (const crPath of cleanupCrPaths) {
        const resource = await readK8sResource(crPath);
        if (hasAnnotation(resource, IMPORT_ANNOTATION)) {
          await client.k8s.removeCrAnnotation(crPath, IMPORT_ANNOTATION);
        }
      }

      // Verify the live CRs were rehydrated, not only the local manifests.
      for (const crPath of cleanupCrPaths) {
        const liveResource = await client.k8s.waitForCr(
          crPath,
          WAIT_FOR_CR_TIMEOUT_SECONDS,
        );
        expect(hasAnnotation(liveResource, IMPORT_ANNOTATION)).toBe(false);
      }

      // ---- Step 7: Validate final state ----
      // GitHub-side resources still exist
      const teamExists = await client.gh.groupExists(TEAM_NAME);
      expect(teamExists).toBe(true);

      const repoExists = await client.gh.repoExists(REPO_NAME);
      expect(repoExists).toBe(true);

      // Mark CR cleanup as safe since we reached here without error
      crCleanupSafe = true;
    },
    LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS,
  );
});
