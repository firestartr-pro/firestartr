import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { captureOutput } from '@oclif/test';
import { join } from 'path';

jest.mock('../src/github/index', () => ({
  createGitHubApi: jest.fn(),
}));

import { createGitHubApi } from '../src/github/index';
import CreateComponent from '../src/commands/create/component';
import Delete from '../src/commands/delete';
import DiscoveryMap from '../src/commands/discovery/map';
import DiscoveryOrgElements from '../src/commands/discovery/org-elements';
import DefaultsApply from '../src/commands/defaults/apply';
import DefaultsList from '../src/commands/defaults/list';
import DefaultsShow from '../src/commands/defaults/show';
import Edit from '../src/commands/edit';
import FeaturesAdd from '../src/commands/features/add';
import FeaturesEdit from '../src/commands/features/edit';
import FeaturesRemove from '../src/commands/features/remove';
import Preflight from '../src/commands/preflight';
import WatchChecks from '../src/commands/watch-checks';
import { ORG_FLAG } from '../src/mutations/support';
import { MemoryGitHubApi } from './fixtures/memoryGitHubApi';

import type { Command, Config } from '@oclif/core';

const ROOT = process.cwd();
const ORIGINAL_ORG = process.env.FSCRT_ORG;
const MockCreateGitHubApi = createGitHubApi as unknown as jest.Mock;

const COMMANDS: Array<[string, typeof Command]> = [
  ['delete', Delete],
  ['edit', Edit],
  ['preflight', Preflight],
  ['watch-checks', WatchChecks],
  ['discovery map', DiscoveryMap],
  ['discovery org-elements', DiscoveryOrgElements],
  ['defaults apply', DefaultsApply],
  ['defaults list', DefaultsList],
  ['defaults show', DefaultsShow],
  ['create component', CreateComponent],
  ['features add', FeaturesAdd],
  ['features edit', FeaturesEdit],
  ['features remove', FeaturesRemove],
];

type CommandClass = typeof Command &
  (new (argv: string[], config: Config) => Command);

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

function mockApi(): MemoryGitHubApi {
  const api = new MemoryGitHubApi();
  const claims = { owner: 'env-org', repo: 'claims' };
  api.setDefaultBranch(claims, 'main');
  api.setFile(
    claims,
    'claims-map.json',
    JSON.stringify({
      headers: { sha: 'map-sha' },
      claims: {
        'ComponentClaim-my-component': {
          filePath: 'components/my-component.yaml',
        },
      },
    }),
    'map-file-sha',
  );
  api.setFile(
    claims,
    'claims/claims_defaults.yaml',
    'ComponentClaim:\n  platformOwner: group:default\n',
  );
  MockCreateGitHubApi.mockReturnValue(api);
  return api;
}

afterEach(() => {
  MockCreateGitHubApi.mockClear();
  process.exitCode = 0;
  if (ORIGINAL_ORG === undefined) {
    delete process.env.FSCRT_ORG;
  } else {
    process.env.FSCRT_ORG = ORIGINAL_ORG;
  }
});

describe('the shared --org flag', () => {
  it.each(COMMANDS)('%s declares the shared ORG_FLAG', (_name, command) => {
    const flag = (command.flags as Record<string, Record<string, unknown>>).org;
    expect(flag).toBeDefined();
    expect(flag.env).toBe('FSCRT_ORG');
    expect(flag.parse).toBe((ORG_FLAG as unknown as Record<string, unknown>).parse);
  });
});

describe('FSCRT_ORG resolution', () => {
  it('resolves the org for defaults show without --org', async () => {
    process.env.FSCRT_ORG = 'env-org';
    mockApi();

    const outcome = await run(DefaultsShow, 'component');

    expect(outcome.result).toBe(0);
    expect(outcome.stdout).toContain('group:default');
    expect(MockCreateGitHubApi).toHaveBeenCalledTimes(1);
  });

  it('resolves the org for defaults list without --org', async () => {
    process.env.FSCRT_ORG = 'env-org';
    mockApi();

    const outcome = await run(DefaultsList, '--json');

    expect(outcome.result).toBe(0);
    expect(JSON.parse(outcome.stdout)).toEqual({
      org: 'env-org',
      kinds: ['ComponentClaim'],
    });
  });

  it('resolves the org for defaults apply without --org', async () => {
    process.env.FSCRT_ORG = 'env-org';
    const api = mockApi();

    const outcome = await run(
      DefaultsApply,
      '-f',
      join(ROOT, '__tests__', 'fixtures', 'valid', 'component.yaml'),
    );

    expect(outcome.result).toBe(0);
    expect(api.calls).toContain('getDefaultBranch env-org/claims');
  });

  it('resolves the org for delete without --org', async () => {
    process.env.FSCRT_ORG = 'env-org';
    const api = mockApi();

    const outcome = await run(Delete, 'component', 'my-component');

    expect(outcome.result).toBe(0);
    expect(outcome.stderr).toContain('Dry run');
    expect(api.calls).toContain(
      'readFile env-org/claims:claims-map.json@claims-index',
    );
  });

  it('resolves the org for watch-checks without --org', async () => {
    process.env.FSCRT_ORG = 'env-org';
    const api = mockApi();

    const outcome = await run(
      WatchChecks,
      'ComponentClaim-my-app',
      '--state-repos',
      'env-org/state-github',
    );

    expect(outcome.error?.oclif?.exit).toBe(3);
    expect(api.calls).toContain(
      'listOpenPullRequests env-org/state-github:automated',
    );
  });
});
