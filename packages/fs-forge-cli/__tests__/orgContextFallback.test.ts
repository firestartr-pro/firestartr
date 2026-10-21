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
import { readFileSync } from 'fs';
import { join } from 'path';

jest.mock('../src/github/index', () => ({
  createGitHubApi: jest.fn(),
}));

import { createGitHubApi } from '../src/github/index';
import CreateComponent from '../src/commands/create/component';
import Delete from '../src/commands/delete';
import OrgElements from '../src/commands/discovery/org-elements';
import Edit from '../src/commands/edit';
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

  it('publishes to the claims repository reported by the config', async () => {
    process.env.FS_FORGE_CONFIG = contextFixture('full.yaml');
    const api = mockClient();
    const ref = { owner: ORG, repo: 'claims-fork' };
    api.setDefaultBranch(ref, 'main');
    api.setFile(
      ref,
      'claims-map.json',
      JSON.stringify(CLAIMS_MAP),
      'map-file-sha',
    );
    const args = CreateComponent.examples[0]
      .replace('<%= config.bin %> <%= command.id %> ', '')
      .split(' ');

    const outcome = await run(CreateComponent, ...args, '--commit');

    expect(outcome.error).toBeUndefined();
    expect(api.committed[0]).toEqual(expect.objectContaining({ ref }));
  });

  it('watches the configured state repos even when the claims owner differs', async () => {
    process.env.FS_FORGE_CONFIG = contextFixture('repo-overrides.yaml');
    const api = mockClient();
    const ref = { owner: 'shared', repo: 'claims-fork' };
    api.setDefaultBranch(ref, 'main');
    api.setFile(
      ref,
      'claims-map.json',
      JSON.stringify(CLAIMS_MAP),
      'map-file-sha',
    );
    const args = CreateComponent.examples[0]
      .replace('<%= config.bin %> <%= command.id %> ', '')
      .split(' ');

    const outcome = await run(
      CreateComponent,
      ...args,
      '--commit',
      '--wait-for-checks',
    );

    expect(outcome.error).toBeUndefined();
    expect(api.committed[0]).toEqual(expect.objectContaining({ ref }));
    expect(api.calls).toContain(
      'listOpenPullRequests acme/state-github-fork:automated',
    );
    expect(api.calls).toContain(
      'listOpenPullRequests other/state-infra-fork:automated',
    );
  });

  it.each(['flag', 'env'] as const)(
    'publishes to configured claims for a mixed-case %s organization',
    async (source) => {
      process.env.FS_FORGE_CONFIG = contextFixture('repo-overrides.yaml');
      const org = source === 'flag' ? 'ACME' : 'AcMe';
      process.env.FSCRT_ORG = source === 'flag' ? 'beta' : org;
      const api = mockClient();
      const ref = { owner: 'shared', repo: 'claims-fork' };
      api.setDefaultBranch(ref, 'main');
      api.setFile(ref, 'claims-map.json', JSON.stringify(CLAIMS_MAP));
      const args = CreateComponent.examples[0]
        .replace('<%= config.bin %> <%= command.id %> ', '')
        .split(' ');
      if (source === 'flag') args.push('--org', org);

      const outcome = await run(CreateComponent, ...args, '--commit');

      expect(outcome.error).toBeUndefined();
      expect(api.committed[0]).toEqual(expect.objectContaining({ ref }));
    },
  );

  it('discovers claims from the configured repo by default', async () => {
    process.env.FS_FORGE_CONFIG = contextFixture('full.yaml');
    const api = mockClient();
    const ref = { owner: ORG, repo: 'claims-fork' };
    api.setDefaultBranch(ref, 'main');
    api.setFile(
      ref,
      'claims-map.json',
      JSON.stringify(CLAIMS_MAP),
      'map-file-sha',
    );

    const outcome = await run(OrgElements, '--json');

    expect(outcome.error).toBeUndefined();
    expect(JSON.parse(outcome.stdout).claimsRepo).toBe('claims-fork');
    expect(api.calls).toContain(
      'readFile acme/claims-fork:claims-map.json@claims-index',
    );
  });

  it('keeps state defaults attached to the selected org when editing across owners', async () => {
    process.env.FS_FORGE_CONFIG = contextFixture('repo-overrides.yaml');
    const api = mockClient();
    const ref = { owner: 'shared', repo: 'claims-fork' };
    api.setDefaultBranch(ref, 'main');
    api.setFile(
      ref,
      'claims-map.json',
      JSON.stringify(CLAIMS_MAP),
      'map-file-sha',
    );
    api.setFile(
      ref,
      'claims/components/my-component.yaml',
      readFileSync(
        join(ROOT, '__tests__/fixtures/valid/component.yaml'),
        'utf8',
      ),
    );

    const outcome = await run(
      Edit,
      'ComponentClaim-my-component',
      '--commit',
      '--wait-for-checks',
    );

    expect(outcome.error).toBeUndefined();
    expect(api.committed[0]).toEqual(expect.objectContaining({ ref }));
    expect(api.calls).toContain(
      'listOpenPullRequests acme/state-github-fork:automated',
    );
    expect(api.calls).toContain(
      'listOpenPullRequests other/state-infra-fork:automated',
    );
  });

  it('keeps an explicit claims-repo flag above the configured override', async () => {
    process.env.FS_FORGE_CONFIG = contextFixture('repo-overrides.yaml');
    const api = mockClient();

    const outcome = await run(OrgElements, '--claims-repo', 'claims', '--json');

    expect(outcome.error).toBeUndefined();
    expect(JSON.parse(outcome.stdout).claimsRepo).toBe('claims');
    expect(api.calls).toContain(
      'readFile acme/claims:claims-map.json@claims-index',
    );
  });

  it('keeps explicit state-repos above the configured defaults', async () => {
    process.env.FS_FORGE_CONFIG = contextFixture('full.yaml');
    const api = mockClient();
    const ref = { owner: ORG, repo: 'claims-fork' };
    api.setDefaultBranch(ref, 'main');
    api.setFile(
      ref,
      'claims-map.json',
      JSON.stringify(CLAIMS_MAP),
      'map-file-sha',
    );
    const args = CreateComponent.examples[0]
      .replace('<%= config.bin %> <%= command.id %> ', '')
      .split(' ');

    const outcome = await run(
      CreateComponent,
      ...args,
      '--commit',
      '--wait-for-checks',
      '--state-repos',
      'custom/one,custom/two',
    );

    expect(outcome.error).toBeUndefined();
    expect(api.calls).toContain('listOpenPullRequests custom/one:automated');
    expect(api.calls).toContain('listOpenPullRequests custom/two:automated');
    expect(api.calls).not.toContain(
      'listOpenPullRequests acme/state-github-fork:automated',
    );
  });

  it('dispatches deletion in the configured claims repository', async () => {
    process.env.FS_FORGE_CONFIG = contextFixture('repo-overrides.yaml');
    const api = mockClient();
    const ref = { owner: 'shared', repo: 'claims-fork' };
    api.setDefaultBranch(ref, 'main');
    api.setFile(
      ref,
      'claims-map.json',
      JSON.stringify(CLAIMS_MAP),
      'map-file-sha',
    );

    const outcome = await run(
      Delete,
      'component',
      'my-component',
      '--commit',
      '--no-wait',
    );

    expect(outcome.error).toBeUndefined();
    expect(api.dispatched[0]).toEqual(
      expect.objectContaining({
        ref,
        workflowId: 'unprovision-claim.yaml',
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
