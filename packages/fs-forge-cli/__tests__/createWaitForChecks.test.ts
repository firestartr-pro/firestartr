import { afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';

jest.mock('../src/github/index', () => ({
  createGitHubApi: jest.fn(),
}));

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
import {
  FAILURE_CHECK,
  SUCCESS_CHECK,
  WET_PR_NUMBER,
  closeIssueBeforeWetChecks,
  expectAuditWetCheckOutcome,
  mockCommitApi,
  prepareAuditIssue,
  runCommand,
} from './fixtures/waitForChecks';

const ORIGINAL_ORG = process.env.FSCRT_ORG;

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

function componentArgs(): string[] {
  return (
    CreateComponent.examples[0]
      .replace('<%= config.bin %> <%= command.id %> ', '')
      .match(/(?:[^\s"]+|"[^"]*")+/g) ?? []
  );
}

beforeAll(() => {
  delete process.env.FSCRT_ORG;
});

afterEach(() => {
  jest.clearAllMocks();
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

    const { error, stderr } = await runCommand(CreateComponent, args);

    expect(error).toBeUndefined();
    expect(api.calls).toContain(
      'listOpenPullRequests my-org/custom-state:automated',
    );
    expect(api.calls).toContain(
      `listCheckRunsForPullRequest my-org/custom-state#${WET_PR_NUMBER}`,
    );
    expect(stderr).toContain('Watching wet PR my-org/custom-state#42...');
    expect(stderr).toContain('All checks passed');
  });

  it('falls back to the conventional state repos when --state-repos is omitted', async () => {
    const api = mockCommitApi({ prs: [] });
    const args = componentArgs();
    args.push('--commit', '--org', 'my-org', '--wait-for-checks');

    const { error, stderr } = await runCommand(CreateComponent, args);

    expect(error).toBeUndefined();
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

  it('watches the wet PR checks by default', async () => {
    const api = mockCommitApi({ checkRuns: [SUCCESS_CHECK] });
    const args = componentArgs();
    args.push(
      '--commit',
      '--org',
      'my-org',
      '--state-repos',
      'my-org/custom-state',
    );

    const { error, stderr } = await runCommand(CreateComponent, args);

    expect(error).toBeUndefined();
    expect(api.calls).toContain(
      `listCheckRunsForPullRequest my-org/custom-state#${WET_PR_NUMBER}`,
    );
    expect(stderr).toContain('All checks passed');
  });

  it('waits for wet PR checks to register before reporting success', async () => {
    const api = mockCommitApi({ checkRuns: [] });
    let reportFirstPoll!: () => void;
    const firstPoll = new Promise<void>((resolve) => {
      reportFirstPoll = resolve;
    });
    jest.spyOn(api, 'listCheckRunsForPullRequest')
      .mockImplementationOnce(async () => {
        reportFirstPoll();
        return [];
      })
      .mockResolvedValue([SUCCESS_CHECK]);

    jest.useFakeTimers();
    try {
      const running = runCommand(CreateComponent, [
        ...componentArgs(), '--commit', '--org', 'my-org',
        '--state-repos', 'my-org/custom-state',
      ]);
      await firstPoll;
      await jest.advanceTimersByTimeAsync(10_000);
      const { error, stderr } = await running;

      expect(error).toBeUndefined();
      expect(stderr).toContain('All checks passed');
    } finally {
      jest.useRealTimers();
      jest.restoreAllMocks();
    }
  });

  it('does not watch checks with --no-wait-for-checks', async () => {
    const api = mockCommitApi();
    const args = componentArgs();
    args.push('--commit', '--org', 'my-org', '--no-wait-for-checks');

    const { error } = await runCommand(CreateComponent, args);

    expect(error).toBeUndefined();
    expect(
      api.calls.some((call) => call.startsWith('listOpenPullRequests')),
    ).toBe(false);
    expect(
      api.calls.some((call) => call.startsWith('listCheckRunsForPullRequest')),
    ).toBe(false);
  });

  it.each([
    { conclusion: 'success', check: SUCCESS_CHECK, message: undefined },
    { conclusion: 'failure', check: FAILURE_CHECK, message: 'Wet PR checks failed: failure' },
    {
      conclusion: 'failure from a block-scalar annotation',
      check: FAILURE_CHECK,
      message: 'Wet PR checks failed: failure',
      annotation: '|\n      custom-state#99\n',
    },
  ])('observes $conclusion checks after the wet PR has merged', async ({ check, message, annotation }) => {
    const api = mockCommitApi({ prs: [] });
    const state = { owner: 'my-org', repo: 'custom-state' };
    api.setFile(
      state,
      'cr.yaml',
      [
        'kind: FirestartrGithubRepository',
        'metadata:',
        '  name: example',
        '  annotations:',
        '    firestartr.dev/claim-ref: ComponentClaim/example',
        `    firestartr.dev/last-state-pr: ${annotation ?? 'custom-state#99'}`,
      ].join('\n'),
    );
    api.setCheckRuns(state, 99, [check]);
    const args = componentArgs();
    args.push('--commit', '--org', 'my-org', '--state-repos', 'my-org/custom-state');

    const { error, stderr } = await runCommand(CreateComponent, args);

    if (message) {
      expect(error?.message).toContain(message);
    } else {
      expect(error).toBeUndefined();
      expect(stderr).toContain('All checks passed');
    }
    expect(stderr).toContain('Watching wet PR my-org/custom-state#99...');
    expect(stderr).not.toContain('skipping check watch');
  });

  it('checks a merged PR even when another state repo has a successful open PR', async () => {
    const api = mockCommitApi({ checkRuns: [SUCCESS_CHECK] });
    const infra = { owner: 'my-org', repo: 'state-infra' };
    api.setPullRequests(infra, []);
    api.setFile(infra, 'cr.yaml', [
      'kind: FirestartrTerraformWorkspace',
      'metadata:',
      '  name: example',
      '  annotations:',
      '    firestartr.dev/claim-ref: ComponentClaim/example',
      '    firestartr.dev/last-state-pr: state-infra#99',
    ].join('\n'));
    api.setCheckRuns(infra, 99, [FAILURE_CHECK]);

    const { error, stderr } = await runCommand(CreateComponent, [
      ...componentArgs(), '--commit', '--org', 'my-org',
    ]);

    expect(error?.message).toContain('Wet PR checks failed: failure');
    expect(stderr).toContain('Watching wet PR my-org/state-github#42...');
    expect(stderr).toContain('Watching wet PR my-org/state-infra#99...');
    expect(stderr).not.toContain('All checks passed');
  });

  it('fails when reconciliation checks fail behind a successful cleanup PR', async () => {
    const api = mockCommitApi({ checkRuns: [SUCCESS_CHECK] });
    const state = { owner: 'my-org', repo: 'custom-state' };
    api.setPullRequestFiles(state, WET_PR_NUMBER, [
      { filename: 'cr.yaml', status: 'removed' },
    ]);
    api.setFile(
      state,
      'cr.yaml',
      [
        'metadata:',
        '  annotations:',
        '    firestartr.dev/claim-ref: ComponentClaim/example',
        '    firestartr.dev/last-state-pr: other-org/reconciled-state#99',
      ].join('\n'),
    );
    api.setCheckRuns({ owner: 'other-org', repo: 'reconciled-state' }, 99, [
      FAILURE_CHECK,
    ]);
    const args = componentArgs();
    args.push('--commit', '--org', 'my-org', '--state-repos', 'my-org/custom-state');

    const { error, stderr } = await runCommand(CreateComponent, args);

    expect(error?.message).toContain('Wet PR checks failed: failure');
    expect(stderr).toContain('Watching wet PR other-org/reconciled-state#99...');
    expect(api.calls).not.toContain(
      `listCheckRunsForPullRequest my-org/custom-state#${WET_PR_NUMBER}`,
    );
  });

  it.each([
    { issue: 'created', flag: ['--create-issue'], check: SUCCESS_CHECK, fails: false },
    { issue: 'created', flag: ['--create-issue'], check: FAILURE_CHECK, fails: true },
    { issue: 'adopted', flag: ['--issue', '1'], check: SUCCESS_CHECK, fails: false },
    { issue: 'adopted', flag: ['--issue', '1'], check: FAILURE_CHECK, fails: true },
  ])('records $issue audit issue outcomes when wet checks fail=$fails', async ({ issue, flag, check, fails }) => {
    const api = mockCommitApi({ checkRuns: [check] });
    await prepareAuditIssue(api, issue);
    closeIssueBeforeWetChecks(api);

    const { error, stderr } = await runCommand(CreateComponent, [
      ...componentArgs(), '--commit', '--org', 'my-org', ...flag,
      '--state-repos', 'my-org/custom-state',
    ]);

    if (fails) {
      expect(error?.message).toContain('Wet PR checks failed: failure');
    } else {
      expect(error).toBeUndefined();
      expect(stderr).toContain('All checks passed');
    }
    expectAuditWetCheckOutcome(
      api,
      fails,
      'The create of ComponentClaim-example failed.\n\nWet PR checks failed: failure',
    );
  });

  it.each([
    { issue: 'created', flag: ['--create-issue'] },
    { issue: 'adopted', flag: ['--issue', '1'] },
  ])('leaves the $issue audit issue open when publishing fails before merge', async ({ issue, flag }) => {
    const api = mockCommitApi();
    await prepareAuditIssue(api, issue);
    api.commitFile = async () => { throw new Error('commit failed'); };

    const { error } = await runCommand(CreateComponent, [
      ...componentArgs(), '--commit', '--org', 'my-org', ...flag,
    ]);

    expect(error?.message).toContain('commit failed');
    expect(api.issues[0].state).toBe('open');
    expect(api.issueComments[0].body).toContain('commit failed');
    expect(api.createdPulls).toHaveLength(0);
  });

  it.each(['action_required', 'stale'])(
    'fails the default create check watch with %s',
    async (conclusion) => {
      mockCommitApi({ checkRuns: [{ ...SUCCESS_CHECK, conclusion }] });

      const { error, stderr } = await runCommand(CreateComponent, [
        ...componentArgs(), '--commit', '--org', 'my-org',
        '--state-repos', 'my-org/custom-state',
      ]);

      expect(error?.message).toContain(`Wet PR checks failed: ${conclusion}`);
      expect(stderr).not.toContain('All checks passed');
    },
  );

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

    const { error } = await runCommand(CreateComponent, args);

    expect(error?.message).toContain('Wet PR checks failed: failure');
  });
});
