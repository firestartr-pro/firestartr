import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { captureOutput } from '@oclif/test';

jest.mock('../src/github/index', () => ({
  createGitHubApi: jest.fn(),
}));

import { createGitHubApi } from '../src/github/index';
import CreateComponent from '../src/commands/create/component';
import Delete from '../src/commands/delete';
import { captureEnv, contextFixture } from './fixtures/contextFixtures';
import { MemoryGitHubApi } from './fixtures/memoryGitHubApi';

const ROOT = process.cwd();
/** The directory `defaults.yaml` claims; it never has to exist on disk. */
const ORG_DIR = '/srv/acme';
const ORG = 'acme';
const env = captureEnv();

const MockCreateGitHubApi = createGitHubApi as unknown as jest.Mock;

const cwd = jest.spyOn(process, 'cwd').mockReturnValue(ORG_DIR);

const CLAIMS_MAP = {
  headers: { sha: 'map-sha' },
  claims: {
    'ComponentClaim-my-component': {
      filePath: 'components/my-component.yaml',
    },
  },
};

function configMatchingCwd(): void {
  process.env.FS_FORGE_CONFIG = contextFixture('defaults.yaml');
}

function mockClient(): MemoryGitHubApi {
  const api = new MemoryGitHubApi();
  api.autoCompleteDispatches = true;
  for (const owner of [ORG, 'my-org']) {
    const ref = { owner, repo: 'claims' };
    api.setDefaultBranch(ref, 'main');
    api.setFile(ref, 'claims-map.json', JSON.stringify(CLAIMS_MAP), 'map-file-sha');
  }
  MockCreateGitHubApi.mockReturnValue(api);
  return api;
}

async function run(
  command: { run(argv: string[], config: { root: string }): Promise<unknown> },
  ...flags: string[]
): Promise<{ stdout: string; stderr: string; error?: Error }> {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    return await captureOutput(async () => {
      await command.run(flags, { root: ROOT });
      return 0;
    });
  } finally {
    process.exitCode = previousExitCode;
  }
}

beforeEach(() => {
  delete process.env.FSCRT_ORG;
  process.env.FS_FORGE_CONFIG = contextFixture('absent.yaml');
});

afterEach(() => {
  MockCreateGitHubApi.mockClear();
  process.exitCode = 0;
  env.restore();
});

// `process` outlives the suite, so put the real cwd back for the next file.
afterAll(() => {
  cwd.mockRestore();
});

describe('--org defaults to the resolved context', () => {
  it('resolves the org for delete without --org from the config match', async () => {
    configMatchingCwd();
    const api = mockClient();

    const outcome = await run(Delete, 'component', 'my-component');

    expect(outcome.error).toBeUndefined();
    expect(outcome.stderr).toContain('Dry run');
    expect(api.calls).toContain(
      `readFile ${ORG}/claims:claims-map.json@claims-index`,
    );
  });

  it('resolves the org for a committing create without --org', async () => {
    configMatchingCwd();
    const api = mockClient();
    const args: string[] = CreateComponent.examples[0]
      .replace('<%= config.bin %> <%= command.id %> ', '')
      .split(' ');
    args.push('--commit');

    const outcome = await run(CreateComponent, ...args);

    expect(outcome.error).toBeUndefined();
    expect(api.committed[0]).toEqual(
      expect.objectContaining({
        ref: { owner: ORG, repo: 'claims' },
        path: 'claims/components/example.yaml',
      }),
    );
  });

  it('keeps --org authoritative over the config match', async () => {
    configMatchingCwd();
    const api = mockClient();

    const outcome = await run(
      Delete,
      'component',
      'my-component',
      '--org',
      'my-org',
    );

    expect(outcome.error).toBeUndefined();
    expect(api.calls).toContain(
      'readFile my-org/claims:claims-map.json@claims-index',
    );
  });

  it('keeps today’s error, plus the context code, when no org resolves', async () => {
    const outcome = await run(Delete, 'component', 'my-component');

    expect(outcome.error?.message).toContain('--org or FSCRT_ORG is required');
    expect(outcome.error?.message).toContain('NO_CONFIG');
    expect(MockCreateGitHubApi).not.toHaveBeenCalled();
  });
});
