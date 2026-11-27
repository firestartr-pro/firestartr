jest.mock('../src/github/index', () => ({
  createGitHubApi: jest.fn(),
}));

jest.mock('../src/utils/featureSource', () => ({
  createFeatureSource: jest.fn(),
  DEFAULT_FEATURE_SOURCE: 'https://example.invalid/features',
}));

import AppDiscover from '../src/commands/app/discover.js';
import { createGitHubApi } from '../src/github/index.js';
import { createFeatureSource } from '../src/utils/featureSource.js';

import { MemoryGitHubApi } from './fixtures/memoryGitHubApi.js';
import { runCommand } from './fixtures/waitForChecks.js';

import type { FeatureSource } from '../src/utils/featureSource.js';

const MockCreateGitHubApi = createGitHubApi as unknown as jest.Mock;
const MockCreateFeatureSource = createFeatureSource as unknown as jest.Mock;

const ORG = 'acme';
const CLAIMS_REPO = 'claims';

type CommandError = {
  oclif?: { exit?: number };
  code?: string;
  message?: string;
};

function featureSource(): FeatureSource {
  return {
    readFeatureIndex: async () => ({ features: [] }),
    readFeatureVersions: async () => [],
    readFeatureSchema: async () => ({}),
    readFeatureDocument: async () => '',
  };
}

function apiWithoutServiceClaim(): MemoryGitHubApi {
  const api = new MemoryGitHubApi();
  const ref = { owner: ORG, repo: CLAIMS_REPO };
  api.addRepo(ref);
  api.setDefaultBranch(ref, 'main');
  api.setFile(ref, 'claims-map.json', '{"headers":{"sha":"x"},"claims":{}}');
  return api;
}

beforeEach(() => {
  MockCreateGitHubApi.mockReturnValue(apiWithoutServiceClaim());
  MockCreateFeatureSource.mockReturnValue(featureSource());
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('fs-forge app discover', () => {
  it('prints the coded error document on stderr under --json', async () => {
    const { stdout, stderr, error } = await runCommand(AppDiscover, [
      '--app',
      'missing-app',
      '--service',
      'ghost-svc',
      '--org',
      ORG,
      '--claims-repo',
      CLAIMS_REPO,
      '--json',
    ]);

    expect(stdout).toBe('');
    const document = JSON.parse(stderr) as {
      error: { code: string; message: string };
    };
    expect(document.error.code).toBe('NO_SERVICE_CLAIM');
    expect(document.error.message).toContain(
      'Service claim not found: ComponentClaim-ghost-svc',
    );
    expect(document.error.message).toContain(
      'fs-forge create component --name ghost-svc --owner <owner>',
    );
    expect((error as CommandError | undefined)?.oclif?.exit).toBe(1);
  });

  it('reports the code and the next step for humans', async () => {
    const { error } = await runCommand(AppDiscover, [
      '--app',
      'missing-app',
      '--service',
      'ghost-svc',
      '--org',
      ORG,
      '--claims-repo',
      CLAIMS_REPO,
    ]);

    const failure = error as CommandError | undefined;
    expect(failure?.code).toBe('NO_SERVICE_CLAIM');
    expect(failure?.message).toContain(
      'Service claim not found: ComponentClaim-ghost-svc',
    );
    expect(failure?.message).toContain(
      'fs-forge create component --name ghost-svc --owner <owner>',
    );
    expect(failure?.oclif?.exit).toBe(1);
  });
});
