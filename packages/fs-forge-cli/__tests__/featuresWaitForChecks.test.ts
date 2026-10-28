import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { tmpdir } from 'os';
import { join } from 'path';

jest.mock('../src/github/index', () => ({
  createGitHubApi: jest.fn(),
}));

import FeaturesAdd from '../src/commands/features/add';
import FeaturesEdit from '../src/commands/features/edit';
import FeaturesRemove from '../src/commands/features/remove';
import {
  FAILURE_CHECK,
  SUCCESS_CHECK,
  WET_PR_NUMBER,
  mockCommitApi,
  runCommand,
} from './fixtures/waitForChecks';

import type { CheckRunSummary } from '../src/github/api';

const ROOT = process.cwd();
const FEATURE_SOURCE = join(ROOT, '__tests__', 'fixtures', 'feature-sources');
const COMPONENT = join(ROOT, '__tests__', 'fixtures', 'valid', 'component.yaml');
const COMPONENT_WITH_FEATURES = join(
  ROOT,
  '__tests__',
  'fixtures',
  'valid',
  'component-with-features.yaml',
);
const ORIGINAL_CACHE_DIR = process.env.FS_FORGE_FEATURE_CACHE_DIR;

const COMPONENT_CLAIM = 'my-component';
const CUSTOM_STATE = ['--state-repos', 'my-org/custom-state'];

interface FeatureCommandLike {
  flags: Record<string, { type?: string; default?: unknown }>;
}

const FEATURE_TARGET_COMMANDS: Array<[string, FeatureCommandLike]> = [
  ['features add', FeaturesAdd as unknown as FeatureCommandLike],
  ['features edit', FeaturesEdit as unknown as FeatureCommandLike],
  ['features remove', FeaturesRemove as unknown as FeatureCommandLike],
];

function featureApi(options: { checkRuns?: CheckRunSummary[] } = {}) {
  return mockCommitApi({
    claimName: COMPONENT_CLAIM,
    checkRuns: options.checkRuns,
  });
}

function addArgs(options: { commit?: boolean } = {}): string[] {
  return [
    '--file',
    COMPONENT,
    '--name',
    'feature_a',
    '--version',
    '1.1.0',
    '--source',
    FEATURE_SOURCE,
    '--refresh',
    '--org',
    'my-org',
    ...(options.commit === false ? [] : ['--commit']),
  ];
}

beforeAll(() => {
  process.env.FS_FORGE_FEATURE_CACHE_DIR = join(
    tmpdir(),
    `fs-forge-feature-wait-checks-${process.pid}`,
  );
});

afterAll(() => {
  if (ORIGINAL_CACHE_DIR === undefined) {
    delete process.env.FS_FORGE_FEATURE_CACHE_DIR;
  } else {
    process.env.FS_FORGE_FEATURE_CACHE_DIR = ORIGINAL_CACHE_DIR;
  }
});

afterEach(() => {
  jest.clearAllMocks();
  process.exitCode = 0;
});

describe('feature command wait-for-checks flags', () => {
  for (const [name, command] of FEATURE_TARGET_COMMANDS) {
    it(`defaults --wait-for-checks to true on ${name}`, () => {
      expect(command.flags['wait-for-checks']?.type).toBe('boolean');
      expect(command.flags['wait-for-checks']?.default).toBe(true);
      expect(command.flags['state-repos']?.type).toBe('option');
    });
  }
});

describe('features add --commit wait-for-checks', () => {
  it('watches the wet PR checks by default', async () => {
    const api = featureApi({ checkRuns: [SUCCESS_CHECK] });

    const { error, stderr } = await runCommand(FeaturesAdd, [
      ...addArgs(),
      ...CUSTOM_STATE,
    ]);

    expect(error).toBeUndefined();
    expect(api.calls).toContain(
      `listCheckRunsForPullRequest my-org/custom-state#${WET_PR_NUMBER}`,
    );
    expect(stderr).toContain('Watching wet PR my-org/custom-state#42...');
    expect(stderr).toContain('All checks passed');
  });

  it('does not watch checks with --no-wait-for-checks', async () => {
    const api = featureApi();

    const { error } = await runCommand(FeaturesAdd, [
      ...addArgs(),
      ...CUSTOM_STATE,
      '--no-wait-for-checks',
    ]);

    expect(error).toBeUndefined();
    expect(
      api.calls.some((call) => call.startsWith('listOpenPullRequests')),
    ).toBe(false);
    expect(
      api.calls.some((call) => call.startsWith('listCheckRunsForPullRequest')),
    ).toBe(false);
  });

  it('does not watch checks without --commit', async () => {
    const api = featureApi();

    const { error } = await runCommand(
      FeaturesAdd,
      addArgs({ commit: false }),
    );

    expect(error).toBeUndefined();
    expect(
      api.calls.some((call) => call.startsWith('listOpenPullRequests')),
    ).toBe(false);
  });

  it('fails the add when the wet PR checks fail', async () => {
    featureApi({ checkRuns: [FAILURE_CHECK] });

    const { error } = await runCommand(FeaturesAdd, [
      ...addArgs(),
      ...CUSTOM_STATE,
    ]);

    expect(error?.message).toContain('Wet PR checks failed: failure');
  });
});

describe('features edit and remove --commit wait-for-checks', () => {
  it('watches the wet PR checks after editing a Feature', async () => {
    const api = featureApi({ checkRuns: [SUCCESS_CHECK] });

    const { error, stderr } = await runCommand(FeaturesEdit, [
      '--file',
      COMPONENT_WITH_FEATURES,
      '--name',
      'feature_a',
      '--version',
      '1.1.0',
      '--source',
      FEATURE_SOURCE,
      '--refresh',
      '--org',
      'my-org',
      '--commit',
      ...CUSTOM_STATE,
    ]);

    expect(error).toBeUndefined();
    expect(api.calls).toContain(
      `listCheckRunsForPullRequest my-org/custom-state#${WET_PR_NUMBER}`,
    );
    expect(stderr).toContain('All checks passed');
  });

  it('watches the wet PR checks after removing a Feature', async () => {
    const api = featureApi({ checkRuns: [SUCCESS_CHECK] });

    const { error, stderr } = await runCommand(FeaturesRemove, [
      '--file',
      COMPONENT_WITH_FEATURES,
      '--name',
      'feature_a',
      '--org',
      'my-org',
      '--commit',
      ...CUSTOM_STATE,
    ]);

    expect(error).toBeUndefined();
    expect(api.calls).toContain(
      `listCheckRunsForPullRequest my-org/custom-state#${WET_PR_NUMBER}`,
    );
    expect(stderr).toContain('All checks passed');
  });
});
