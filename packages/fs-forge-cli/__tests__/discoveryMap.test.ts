import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { captureOutput } from '@oclif/test';
import { join } from 'path';

import { loadClaimsArchive } from '../src/claims/archive';
import DiscoveryMap from '../src/commands/discovery/map';
import { createClaimValidator } from '../src/utils/ajvValidation';

jest.mock('../src/claims/archive', () => ({
  loadClaimsArchive: jest.fn(),
}));

const loadClaimsArchiveMock = jest.mocked(loadClaimsArchive);

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
  delete process.env.FSCRT_ORG;
  delete process.env.GITHUB_TOKEN;
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
    process.env.GITHUB_TOKEN = 'test-token';
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
    process.env.GITHUB_TOKEN = 'test-token';
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

  it('reports archive fetch failures', async () => {
    process.env.GITHUB_TOKEN = 'test-token';
    loadClaimsArchiveMock.mockRejectedValue(new Error('archive unavailable'));

    const result = await runMap(['--org', 'example']);

    expect(result.error?.message).toContain('archive unavailable');
  });
});
