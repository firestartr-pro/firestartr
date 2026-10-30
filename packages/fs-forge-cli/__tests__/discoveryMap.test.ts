import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { captureOutput } from '@oclif/test';
import { join } from 'path';

import { loadClaimsArchive } from '../src/claims/archive';
import DiscoveryMap from '../src/commands/discovery/map';
import { createClaimValidator } from '../src/utils/ajvValidation';
import { captureEnv, contextFixture } from './fixtures/contextFixtures';

jest.mock('../src/claims/archive', () => ({
  loadClaimsArchive: jest.fn(),
}));
jest.mock('../src/github/index', () => ({ createGitHubApi: jest.fn() }));

const loadClaimsArchiveMock = jest.mocked(loadClaimsArchive);
const env = captureEnv();

async function runMap(flags: string[]) {
  return captureOutput(async () => {
    await DiscoveryMap.run(flags, { root: process.cwd() });
    return 0;
  });
}

const claims = [
  {
    kind: 'GroupClaim',
    name: 'platform',
    children: ['user:alice'],
  },
  { kind: 'UserClaim', name: 'alice' },
  { kind: 'ComponentClaim', name: 'api', owner: 'group:platform' },
];

afterEach(() => {
  env.restore();
  loadClaimsArchiveMock.mockReset();
  process.exitCode = 0;
});

describe('discovery map', () => {
  it('requires an organization before fetching claims', async () => {
    const result = await runMap([]);

    expect(result.error?.message).toContain('--org or FSCRT_ORG is required');
    expect(loadClaimsArchiveMock).not.toHaveBeenCalled();
  });

  it('renders repeatable kind filters with ASCII icons', async () => {
    loadClaimsArchiveMock.mockResolvedValue(claims);

    const result = await runMap([
      '--org',
      'example',
      '--kind',
      'group',
      '--kind',
      'user',
      '--ascii',
    ]);

    expect(result.stdout).toBe(
      '[GRP] GroupClaim: platform\n└─ [USR] UserClaim: alice (children)\n',
    );
    expect(loadClaimsArchiveMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['component', ['ComponentClaim']],
    ['GroupClaim', ['GroupClaim']],
  ])('filters structured JSON output by --kind %s', async (kind, expectedKinds) => {
    loadClaimsArchiveMock.mockResolvedValue(claims);

    const result = await runMap([
      '--org',
      'example',
      '--kind',
      kind,
      '--json',
    ]);
    const graph = JSON.parse(result.stdout) as {
      nodes: Array<{ kind: string }>;
      edges: unknown[];
    };

    expect(graph.nodes.map((node) => node.kind)).toEqual(expectedKinds);
    expect(graph.edges).toEqual([]);

    const validator = createClaimValidator({
      schemasDir: join(process.cwd(), 'schemas'),
    });
    const validation = await validator.validate(graph, 'RelationGraph');
    expect(validation).toEqual({ valid: true, errors: [] });
  });

  it('downloads the archive from the configured claims repository', async () => {
    process.env.FS_FORGE_CONFIG = contextFixture('repo-overrides.yaml');
    loadClaimsArchiveMock.mockResolvedValue(claims);

    const result = await runMap(['--org', 'acme', '--json']);

    expect(result.error).toBeUndefined();
    expect(loadClaimsArchiveMock).toHaveBeenCalledWith(
      undefined,
      { owner: 'shared', repo: 'claims-fork' },
      undefined,
    );
  });

  it('reports archive fetch failures', async () => {
    loadClaimsArchiveMock.mockRejectedValue(new Error('archive unavailable'));

    const result = await runMap(['--org', 'example']);

    expect(result.error?.message).toContain('archive unavailable');
  });
});
