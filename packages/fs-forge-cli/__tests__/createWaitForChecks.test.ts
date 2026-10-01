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

jest.mock('../src/claims/client', () => ({
  ClaimsClient: jest.fn(),
}));

import { ClaimsClient } from '../src/claims/client';
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

const ROOT = process.cwd();
const ORIGINAL_ORG = process.env.FSCRT_ORG;
const MockClaimsClient = ClaimsClient as unknown as jest.Mock;

interface MockPr {
  number: number;
  html_url: string;
  state: string;
  head: { ref: string };
  base: { ref: string; sha: string };
  updated_at: string;
}

interface MockCheckRun {
  name: string;
  conclusion: string | null;
  status: string;
  output: { title: string | null; summary: string; text: string | null };
  html_url: string;
}

const MATCHING_PR: MockPr = {
  number: 42,
  html_url: 'https://github.com/my-org/custom-state/pull/42',
  state: 'open',
  head: { ref: 'automated-component-example' },
  base: { ref: 'main', sha: 'base-sha' },
  updated_at: '2026-01-01T00:00:00Z',
};

const SUCCESS_CHECK: MockCheckRun = {
  name: 'plan',
  conclusion: 'success',
  status: 'completed',
  output: {
    title: null,
    summary: 'ComponentClaim/example: success',
    text: null,
  },
  html_url: 'https://github.com/my-org/custom-state/checks/1',
};

const FAILURE_CHECK: MockCheckRun = {
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

function mockCommitClient(options: {
  prs?: MockPr[];
  checkRuns?: MockCheckRun[];
} = {}) {
  const listPullRequests = jest.fn(
    async (_owner: string, _repo: string, _options: unknown) =>
      options.prs ?? [MATCHING_PR],
  );
  const listCheckRuns = jest.fn(
    async (_owner: string, _repo: string, _pullNumber: number) =>
      options.checkRuns ?? [SUCCESS_CHECK],
  );
  const client = {
    hasInFlightClaimsMapWorkflow: jest.fn(async () => false),
    getFile: jest.fn(async (path: string) => {
      if (path !== 'claims-map.json') return null;
      return {
        content: JSON.stringify({ headers: { sha: 'map-sha' }, claims: {} }),
        path,
        sha: 'map-file-sha',
      };
    }),
    listCheckRuns,
    listFilesInPr: jest.fn(async () => []),
    listPullRequests,
    publishClaim: jest.fn(async () => ({
      url: 'https://example.test/workflow',
      correlationId: 'corr-1',
      workflowId: 'provision-claim.yaml',
      branch: 'fs-forge/ComponentClaim-example',
    })),
    waitForWorkflow: jest.fn(async () => ({
      runUrl: 'https://github.com/my-org/claims/actions/runs/1',
      runId: 1,
      conclusion: 'success',
    })),
  };
  MockClaimsClient.mockImplementation(() => client);
  return client;
}

beforeAll(() => {
  delete process.env.FSCRT_ORG;
});

afterEach(() => {
  MockClaimsClient.mockClear();
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
    const client = mockCommitClient();
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
    expect(client.listPullRequests).toHaveBeenCalledWith(
      'my-org',
      'custom-state',
      expect.objectContaining({ state: 'open' }),
    );
    expect(client.listCheckRuns).toHaveBeenCalledWith(
      'my-org',
      'custom-state',
      MATCHING_PR.number,
    );
    expect(stderr).toContain('Watching wet PR my-org/custom-state#42...');
    expect(stderr).toContain('All checks passed');
  });

  it('falls back to the conventional state repos when --state-repos is omitted', async () => {
    const client = mockCommitClient({ prs: [] });
    const args = componentArgs();
    args.push('--commit', '--org', 'my-org', '--wait-for-checks');

    const { result, stderr } = await run(CreateComponent, ...args);

    expect(result).toBe(0);
    expect(client.listPullRequests).toHaveBeenCalledWith(
      'my-org',
      'state-github',
      expect.objectContaining({ state: 'open' }),
    );
    expect(client.listPullRequests).toHaveBeenCalledWith(
      'my-org',
      'state-infra',
      expect.objectContaining({ state: 'open' }),
    );
    expect(client.listCheckRuns).not.toHaveBeenCalled();
    expect(stderr).toContain(
      'No wet PR found for this claim; skipping check watch.',
    );
  });

  it('does not watch checks when --wait-for-checks is absent', async () => {
    const client = mockCommitClient();
    const args = componentArgs();
    args.push('--commit', '--org', 'my-org');

    const { result } = await run(CreateComponent, ...args);

    expect(result).toBe(0);
    expect(client.listPullRequests).not.toHaveBeenCalled();
    expect(client.listCheckRuns).not.toHaveBeenCalled();
  });

  it('fails the create when the wet PR checks fail', async () => {
    mockCommitClient({ checkRuns: [FAILURE_CHECK] });
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
