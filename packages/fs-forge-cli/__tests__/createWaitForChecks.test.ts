import {
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { Command, Config } from '@oclif/core';
import { captureOutput } from '@oclif/test';

jest.mock('../src/github/index', () => ({
  createGitHubApi: jest.fn(),
}));

import { createGitHubApi } from '../src/github/index';
import CreateArgodeploy from '../src/commands/create/argodeploy';
import CreateComponent from '../src/commands/create/component';
import CreateDomain from '../src/commands/create/domain';
import CreateGroup from '../src/commands/create/group';
import CreateOrgsettings from '../src/commands/create/orgsettings';
import CreateOrgwebhook from '../src/commands/create/orgwebhook';
import CreateSecrets from '../src/commands/create/secrets';
import CreateSystem from '../src/commands/create/system';
import CreateTfworkspace from '../src/commands/create/tfworkspace';
import CreateUser from '../src/commands/create/user';
import { MemoryGitHubApi } from './fixtures/memoryGitHubApi';

import type { CheckRunSummary, PullRequestSummary } from '../src/github/api';

const ROOT = process.cwd();
const ORIGINAL_ORG = process.env.FSCRT_ORG;
const MockCreateGitHubApi = createGitHubApi as unknown as jest.Mock;

const MATCHING_PR: PullRequestSummary = {
  number: 42,
  htmlUrl: 'https://github.com/my-org/custom-state/pull/42',
  state: 'open',
  headRef: 'automated-component-example',
  baseSha: 'base-sha',
  updatedAt: '2026-01-01T00:00:00Z',
};

const SUCCESS_CHECK: CheckRunSummary = {
  name: 'plan',
  conclusion: 'success',
  status: 'completed',
  output: {
    title: null,
    summary: 'ComponentClaim/example: success',
    text: null,
  },
  htmlUrl: 'https://github.com/my-org/custom-state/checks/1',
};

const FAILURE_CHECK: CheckRunSummary = {
  ...SUCCESS_CHECK,
  name: 'apply',
  conclusion: 'failure',
  output: {
    title: null,
    summary: 'ComponentClaim/example: failure',
    text: null,
  },
};

interface CreateCommandLike {
  flags: Record<string, { type?: string }>;
}

const CREATE_COMMANDS: Array<[string, CreateCommandLike]> = [
  ['argodeploy', CreateArgodeploy as unknown as CreateCommandLike],
  ['component', CreateComponent as unknown as CreateCommandLike],
  ['domain', CreateDomain as unknown as CreateCommandLike],
  ['group', CreateGroup as unknown as CreateCommandLike],
  ['orgsettings', CreateOrgsettings as unknown as CreateCommandLike],
  ['orgwebhook', CreateOrgwebhook as unknown as CreateCommandLike],
  ['secrets', CreateSecrets as unknown as CreateCommandLike],
  ['system', CreateSystem as unknown as CreateCommandLike],
  ['tfworkspace', CreateTfworkspace as unknown as CreateCommandLike],
  ['user', CreateUser as unknown as CreateCommandLike],
];

type CommandClass = typeof Command &
  (new (argv: string[], config: Config) => Command);

function componentArgs(): string[] {
  return (
    CreateComponent.examples[0]
      .replace('<%= config.bin %> <%= command.id %> ', '')
      .match(/(?:[^\s"]+|"[^"]*")+/g) ?? []
  );
}

async function run(command: CommandClass, ...flags: string[]) {
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

function mockCommitApi(
  options: {
    prs?: PullRequestSummary[];
    checkRuns?: CheckRunSummary[];
  } = {},
): MemoryGitHubApi {
  const api = new MemoryGitHubApi();
  api.autoCompleteDispatches = true;
  const claims = { owner: 'my-org', repo: 'claims' };
  api.setDefaultBranch(claims, 'main');
  api.setBranchHeadSha(claims, 'main', 'base-sha');
  api.setFile(
    claims,
    'claims-map.json',
    JSON.stringify({ headers: { sha: 'map-sha' }, claims: {} }),
    'map-file-sha',
  );

  for (const repo of ['custom-state', 'state-github', 'state-infra']) {
    const ref = { owner: 'my-org', repo };
    api.setPullRequests(ref, options.prs ?? [MATCHING_PR]);
    if (options.checkRuns !== undefined) {
      api.setCheckRuns(
        ref,
        MATCHING_PR.number,
        options.checkRuns,
      );
    }
  }

  MockCreateGitHubApi.mockReturnValue(api);
  return api;
}

beforeAll(() => {
  delete process.env.FSCRT_ORG;
});

afterEach(() => {
  MockCreateGitHubApi.mockClear();
  process.exitCode = 0;
  if (ORIGINAL_ORG === undefined) {
    delete process.env.FSCRT_ORG;
  } else {
    process.env.FSCRT_ORG = ORIGINAL_ORG;
  }
});

describe('generated create command wait-for-checks flags', () => {
  for (const [name, command] of CREATE_COMMANDS) {
    it(`exposes --wait-for-checks and --state-repos on create ${name}`, () => {
      expect(command.flags['wait-for-checks']?.type).toBe('boolean');
      expect(command.flags['state-repos']?.type).toBe('option');
    });
  }
});

describe('create --wait-for-checks forwarding', () => {
  it('watches the wet PR checks in the requested --state-repos repo', async () => {
    const api = mockCommitApi({ checkRuns: [SUCCESS_CHECK] });
    const args = componentArgs();
    args.push(
      '--commit',
      '--org',
      'my-org',
      '--wait-for-checks',
      '--state-repos',
      'my-org/custom-state',
    );

    const { result, stderr } = await run(CreateComponent, ...args);

    expect(result).toBe(0);
    expect(api.calls).toContain(
      'listOpenPullRequests my-org/custom-state:automated',
    );
    expect(api.calls).toContain(
      `listCheckRunsForPullRequest my-org/custom-state#${MATCHING_PR.number}`,
    );
    expect(stderr).toContain('Watching wet PR my-org/custom-state#42...');
    expect(stderr).toContain('All checks passed');
  });

  it('falls back to the conventional state repos when --state-repos is omitted', async () => {
    const api = mockCommitApi({ prs: [] });
    const args = componentArgs();
    args.push('--commit', '--org', 'my-org', '--wait-for-checks');

    const { result, stderr } = await run(CreateComponent, ...args);

    expect(result).toBe(0);
    expect(api.calls).toContain(
      'listOpenPullRequests my-org/state-github:automated',
    );
    expect(api.calls).toContain(
      'listOpenPullRequests my-org/state-infra:automated',
    );
    expect(
      api.calls.some((call) => call.startsWith('listCheckRunsForPullRequest')),
    ).toBe(false);
    expect(stderr).toContain(
      'No wet PR found for this claim; skipping check watch.',
    );
  });

  it('does not watch checks when --wait-for-checks is absent', async () => {
    const api = mockCommitApi();
    const args = componentArgs();
    args.push('--commit', '--org', 'my-org');

    const { result } = await run(CreateComponent, ...args);

    expect(result).toBe(0);
    expect(
      api.calls.some((call) => call.startsWith('listOpenPullRequests')),
    ).toBe(false);
    expect(
      api.calls.some((call) => call.startsWith('listCheckRunsForPullRequest')),
    ).toBe(false);
  });

  it('fails the create when the wet PR checks fail', async () => {
    mockCommitApi({ checkRuns: [FAILURE_CHECK] });
    const args = componentArgs();
    args.push(
      '--commit',
      '--org',
      'my-org',
      '--wait-for-checks',
      '--state-repos',
      'my-org/custom-state',
    );

    const { error } = await run(CreateComponent, ...args);

    expect(error?.message).toContain('Wet PR checks failed: failure');
  });
});
