import common from 'catalog_common';
import github from 'github';
import {
  CleanupRunner,
  applyAndWaitCrPaths,
  cleanupRenderedArtifacts,
  createNameBuilder,
  destroyFixtureResources,
  ensureDefaultGroup,
  initE2e,
  type E2EApi,
  type FixtureResourceInput,
} from '../..';
import { buildComponentClaimPatches } from '../../src/claim-patches';
import { readK8sResource } from '../../src/cr-finder';
import { isRetryableGitHubError } from '../../src/gh/wait';
import { LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS } from '../../src/test-constants';
import {
  createRetryableError,
  isRetryableError,
  pollUntil,
  retryAsync,
} from '../../src/utils/async-control';

const CHARTS_REPO_V1_FEATURES: Record<string, unknown>[] = [
  { name: 'charts_repo', ref: 'charts_repo-v1' },
];
const SPLIT_RELEASE_PLEASE_FEATURES: Record<string, unknown>[] = [
  { name: 'charts_repo', ref: 'charts_repo-v2' },
  {
    name: 'release_please',
    ref: 'release_please-v1',
    args: { release_type: 'helm' },
  },
];
const RELEASE_PLEASE_FILE_PATHS = [
  'release-please-config.json',
  '.release-please-manifest.json',
];
const RELEASE_PLEASE_FILE_CONTENTS: Record<string, string> = {
  'release-please-config.json': [
    '{',
    '  "release-type": "helm",',
    '  "packages": {',
    '    "charts/empty-chart": {}',
    '  }',
    '}',
    '',
  ].join('\n'),
  '.release-please-manifest.json': [
    '{',
    '  "charts/empty-chart": "0.0.0"',
    '}',
    '',
  ].join('\n'),
};
const FEATURE_FILE_READ_TIMEOUT_MS = 5 * 60 * 1000;
const FEATURE_FILE_READ_INTERVAL_MS = 10000;
const GITHUB_WRITE_RETRY_ATTEMPTS = 5;
const GITHUB_WRITE_RETRY_DELAY_MS = 5000;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readRepoFileIfAvailable(
  client: E2EApi,
  repoName: string,
  filePath: string,
): Promise<string | null> {
  try {
    return await client.gh.tryGetRepoFile(repoName, filePath);
  } catch (error) {
    if (isRetryableGitHubError(error)) {
      throw createRetryableError(error);
    }

    throw error;
  }
}

async function waitForRepoFile(
  client: E2EApi,
  repoName: string,
  filePath: string,
): Promise<string> {
  const org = client.getOrg();
  const content = await pollUntil(
    () => readRepoFileIfAvailable(client, repoName, filePath),
    {
      timeoutMs: FEATURE_FILE_READ_TIMEOUT_MS,
      intervalMs: FEATURE_FILE_READ_INTERVAL_MS,
      isDone: (value) => value !== null,
      shouldRetryError: isRetryableError,
      onRetryError: (error, intervalMs) => {
        common.logger.warn(
          `Retrying read of ${org}/${repoName}/${filePath} after ${intervalMs}ms due to: ${getErrorMessage(error)}`,
        );
      },
      createTimeoutError: () =>
        new Error(
          `Timed out waiting for ${org}/${repoName}/${filePath} to exist`,
        ),
    },
  );

  if (content === null) {
    throw new Error(`Expected ${org}/${repoName}/${filePath} to exist`);
  }

  return content;
}

async function waitForRepoFileContent(
  client: E2EApi,
  repoName: string,
  filePath: string,
  expectedContent: string,
): Promise<void> {
  const org = client.getOrg();
  await pollUntil(
    async () => {
      const content = await readRepoFileIfAvailable(client, repoName, filePath);
      if (content !== null && content !== expectedContent) {
        throw new Error(
          [
            `Expected ${org}/${repoName}/${filePath} content to remain unchanged.`,
            `Expected:\n${expectedContent}`,
            `Received:\n${content}`,
          ].join('\n'),
        );
      }

      return content;
    },
    {
      timeoutMs: FEATURE_FILE_READ_TIMEOUT_MS,
      intervalMs: FEATURE_FILE_READ_INTERVAL_MS,
      isDone: (value) => value === expectedContent,
      shouldRetryError: isRetryableError,
      onRetryError: (error, intervalMs) => {
        common.logger.warn(
          `Retrying content read of ${org}/${repoName}/${filePath} after ${intervalMs}ms due to: ${getErrorMessage(error)}`,
        );
      },
      createTimeoutError: () =>
        new Error(
          `Timed out waiting for ${org}/${repoName}/${filePath} to exist with expected content`,
        ),
    },
  );
}

async function writeRepoFile(
  repoName: string,
  org: string,
  filePath: string,
  content: string,
): Promise<void> {
  await retryAsync(
    () =>
      github.repo.setContent(
        filePath,
        content,
        repoName,
        org,
        'main',
        `test: seed user-managed file ${filePath}`,
      ),
    {
      attempts: GITHUB_WRITE_RETRY_ATTEMPTS,
      shouldRetry: (error) => isRetryableGitHubError(error),
      getDelayMs: () => GITHUB_WRITE_RETRY_DELAY_MS,
    },
  );
}

async function writeReleasePleaseFiles(
  client: E2EApi,
  repoName: string,
): Promise<void> {
  const org = client.getOrg();
  for (const [filePath, content] of Object.entries(
    RELEASE_PLEASE_FILE_CONTENTS,
  )) {
    await writeRepoFile(repoName, org, filePath, content);
  }
}

async function readReleasePleaseSnapshot(
  client: E2EApi,
  repoName: string,
): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};

  for (const filePath of RELEASE_PLEASE_FILE_PATHS) {
    snapshot[filePath] = await waitForRepoFile(client, repoName, filePath);
  }

  return snapshot;
}

async function expectReleasePleaseSnapshot(
  client: E2EApi,
  repoName: string,
  snapshot: Record<string, string>,
): Promise<void> {
  for (const [filePath, content] of Object.entries(snapshot)) {
    await waitForRepoFileContent(client, repoName, filePath, content);
  }
}

async function findFeatureCrPaths(crPaths: string[]): Promise<string[]> {
  const featureCrPaths: string[] = [];

  for (const crPath of crPaths) {
    const resource = await readK8sResource(crPath);
    if (resource.kind === 'FirestartrGithubRepositoryFeature') {
      featureCrPaths.push(crPath);
    }
  }

  if (featureCrPaths.length === 0) {
    throw new Error('Expected rendered component to include a feature CR');
  }

  return featureCrPaths;
}

async function getUserManagedFeatureFilePaths(
  featureCrPaths: string[],
): Promise<string[]> {
  const userManagedFilePaths = new Set<string>();

  for (const crPath of featureCrPaths) {
    const resource = await readK8sResource(crPath);
    const files = isRecord(resource.spec) ? resource.spec.files : undefined;
    if (!Array.isArray(files)) {
      continue;
    }

    for (const file of files) {
      if (
        isRecord(file) &&
        file.userManaged === true &&
        typeof file.path === 'string'
      ) {
        userManagedFilePaths.add(file.path);
      }
    }
  }

  return [...userManagedFilePaths].sort();
}

async function renderComponent(
  client: E2EApi,
  claimName: string,
  repoName: string,
  ownerRef: string,
  platformGroupRef: string,
  features: Record<string, unknown>[],
): Promise<string[]> {
  const rendered = await client.claims.renderLocally(claimName, {
    sourceFixtureName: 'component-a',
    claimName,
    patches: buildComponentClaimPatches({
      name: repoName,
      org: client.getOrg(),
      ownerRef,
      platformOwnerRef: platformGroupRef,
      description: `User-managed feature files e2e repository ${repoName}`,
      features,
    }),
  });

  return rendered.crPaths;
}

describe('Component user-managed feature files E2E', () => {
  let client: E2EApi;
  let fixtures: FixtureResourceInput[] = [];
  let defaultGroupRef = '';
  let platformGroupRef = '';
  let componentClaimName = '';
  let componentRepoName = '';

  beforeAll(async () => {
    client = await initE2e(undefined, undefined, {
      namePrefix: 'component-user-managed-files',
      onlyFiles: ['firestartr', 'group_a', 'component_a'],
    });

    const nameBuilder = createNameBuilder(client.getPrefix());
    const defaultGroupName = nameBuilder.build('default-group');
    const platformGroupName = nameBuilder.build('group-a');
    componentClaimName = nameBuilder.build('feature-split');
    componentRepoName = componentClaimName;
    platformGroupRef = `group:${platformGroupName}`;

    fixtures = [
      { fixtureName: 'firestartr', claimName: defaultGroupName },
      { fixtureName: 'group-a', claimName: platformGroupName },
      { fixtureName: 'component-a', claimName: componentClaimName },
    ];

    await destroyFixtureResources(client, client.getPrefix(), fixtures, {
      logPrefix: 'component-user-managed-files',
      strict: true,
    });

    const defaultGroup = await ensureDefaultGroup(client);
    defaultGroupRef = defaultGroup.ref;

    const renderedPlatformGroup = await client.claims.renderLocally('group-a', {
      patches: [{ op: 'replace', path: '/members', value: [] }],
    });
    await applyAndWaitCrPaths(client, renderedPlatformGroup.crPaths);
  }, LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS);

  afterAll(async () => {
    if (!client) {
      return;
    }

    const cleanup = new CleanupRunner();

    await cleanup.run(
      'destroy user-managed feature file resources',
      async () => {
        await destroyFixtureResources(client, client.getPrefix(), fixtures, {
          logPrefix: 'component-user-managed-files-afterall',
          strict: true,
        });
      },
    );

    await cleanup.run('cleanup rendered artifacts', async () => {
      await cleanupRenderedArtifacts(client);
    });

    cleanup.warnOnErrors('component-user-managed-files', 'afterAll');
  }, LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS);

  it(
    'keeps release-please files unchanged after charts_repo split update',
    async () => {
      const initialCrPaths = await renderComponent(
        client,
        componentClaimName,
        componentRepoName,
        defaultGroupRef,
        platformGroupRef,
        CHARTS_REPO_V1_FEATURES,
      );
      const initialFeatureCrPaths = await findFeatureCrPaths(initialCrPaths);
      await expect(
        getUserManagedFeatureFilePaths(initialFeatureCrPaths),
      ).resolves.toEqual(expect.arrayContaining(RELEASE_PLEASE_FILE_PATHS));

      await applyAndWaitCrPaths(client, initialCrPaths);
      await expect(client.gh.repoExists(componentRepoName)).resolves.toBe(true);
      await readReleasePleaseSnapshot(client, componentRepoName);

      await writeReleasePleaseFiles(client, componentRepoName);

      const updatedCrPaths = await renderComponent(
        client,
        componentClaimName,
        componentRepoName,
        defaultGroupRef,
        platformGroupRef,
        SPLIT_RELEASE_PLEASE_FEATURES,
      );
      await applyAndWaitCrPaths(client, updatedCrPaths);

      await expectReleasePleaseSnapshot(
        client,
        componentRepoName,
        RELEASE_PLEASE_FILE_CONTENTS,
      );
    },
    LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS,
  );
});
