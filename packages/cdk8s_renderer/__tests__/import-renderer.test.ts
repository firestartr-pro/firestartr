import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import YAML from 'yaml';

import {
  renderFromImports,
  buildPreviousClaimsIndex,
  buildPreviousClaimsSymbols,
} from '../src/renderer/import-renderer';
import { RenderClaims } from '../src/renderer/types';
import { MOCK_STITCHING_FEATURES } from '../src/claims/stitching/stitching';
import { createTestContext, type TestContext } from './auxiliar';

jest.mock('../src/renderer/claims-render', () => ({
  renderClaims: jest.fn().mockResolvedValue({}),
  renameVariantCrFiles: jest.fn(),
}));

jest.mock('../src/loader/loader', () => ({
  loadClaimDefaults: jest.fn().mockReturnValue(undefined),
  patchClaim: jest.fn(),
}));

jest.mock('../src/claims/base/validation', () => ({
  validateClaim: jest.fn(),
}));

jest.mock('../src/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'import-renderer-test-'));
}

function makePreviousCR(kind: string, externalName: string, claimName: string) {
  return {
    kind,
    metadata: {
      name: `${claimName}-uuid`,
      annotations: {
        'firestartr.dev/external-name': externalName,
        'firestartr.dev/claim-ref': `${kind}/${claimName}`,
      },
    },
  };
}

describe('buildPreviousClaimsIndex', () => {
  it('maps memberships and groups by external-name to claim names', () => {
    const crs = {
      'FirestartrGithubMembership-user-b-uuid': makePreviousCR(
        'FirestartrGithubMembership',
        'user-b',
        'user-b',
      ),
      'FirestartrGithubGroup-research-arc-dev-uuid': makePreviousCR(
        'FirestartrGithubGroup',
        'Research - Arc & Dev',
        'research-arc-dev',
      ),
    };

    const index = buildPreviousClaimsIndex(crs);

    expect(index.user.get('user-b')).toBe('user-b');
    expect(index.group.get('Research - Arc & Dev')).toBe('research-arc-dev');
  });

  it('ignores CRs that are not memberships or groups', () => {
    const crs = {
      'FirestartrGithubRepository-test-import-uuid': makePreviousCR(
        'FirestartrGithubRepository',
        'test-import',
        'test-import',
      ),
    };

    const index = buildPreviousClaimsIndex(crs);

    expect(index.user.size).toBe(0);
    expect(index.group.size).toBe(0);
  });

  it('ignores CRs without external-name or claim-ref annotations', () => {
    const crs = {
      'FirestartrGithubMembership-incomplete-uuid': {
        kind: 'FirestartrGithubMembership',
        metadata: { name: 'incomplete-uuid' },
      },
    };

    const index = buildPreviousClaimsIndex(crs);

    expect(index.user.size).toBe(0);
    expect(index.group.size).toBe(0);
  });

  it('returns empty maps when crs is empty', () => {
    const index = buildPreviousClaimsIndex({});

    expect(index.user.size).toBe(0);
    expect(index.group.size).toBe(0);
  });
});

describe('buildPreviousClaimsSymbols', () => {
  it('maps memberships and groups by claim kind and claim name', () => {
    const crs = {
      'FirestartrGithubMembership-user-b-uuid': makePreviousCR(
        'FirestartrGithubMembership',
        'user-b',
        'user-b',
      ),
      'FirestartrGithubGroup-research-arc-dev-uuid': makePreviousCR(
        'FirestartrGithubGroup',
        'Research - Arc & Dev',
        'research-arc-dev',
      ),
    };

    const symbols = buildPreviousClaimsSymbols(crs);

    expect(Object.keys(symbols).sort()).toEqual([
      'GroupClaim-research-arc-dev',
      'UserClaim-user-b',
    ]);
    expect(symbols['UserClaim-user-b']).toEqual(
      crs['FirestartrGithubMembership-user-b-uuid'],
    );
    expect(symbols['GroupClaim-research-arc-dev']).toEqual(
      crs['FirestartrGithubGroup-research-arc-dev-uuid'],
    );
  });

  it('ignores CRs that are not memberships or groups', () => {
    const crs = {
      'FirestartrGithubRepository-test-import-uuid': makePreviousCR(
        'FirestartrGithubRepository',
        'test-import',
        'test-import',
      ),
    };

    const symbols = buildPreviousClaimsSymbols(crs);

    expect(Object.keys(symbols)).toHaveLength(0);
  });

  it('ignores CRs without a claim-ref annotation', () => {
    const crs = {
      'FirestartrGithubMembership-incomplete-uuid': {
        kind: 'FirestartrGithubMembership',
        metadata: { name: 'incomplete-uuid' },
      },
    };

    const symbols = buildPreviousClaimsSymbols(crs);

    expect(Object.keys(symbols)).toHaveLength(0);
  });

  it('returns empty symbols when crs is empty', () => {
    const symbols = buildPreviousClaimsSymbols({});

    expect(Object.keys(symbols)).toHaveLength(0);
  });
});

describe('renderFromImports', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    MOCK_STITCHING_FEATURES(undefined);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makePreviousCrs() {
    return {
      'FirestartrGithubMembership-user-b-uuid': makePreviousCR(
        'FirestartrGithubMembership',
        'user-b',
        'user-b',
      ),
      'FirestartrGithubGroup-research-arc-dev-uuid': makePreviousCR(
        'FirestartrGithubGroup',
        'Research - Arc & Dev',
        'research-arc-dev',
      ),
    };
  }

  function makeRenderClaim() {
    const renderClaims: RenderClaims = {
      'ComponentClaim-test-import': {
        claim: {
          kind: 'ComponentClaim',
          name: 'test-import',
          providers: {
            github: { org: 'example-org', name: 'test-import' },
          },
          spec: {
            owner: 'user-imported-ref:user-b',
            parentTeam: 'group-imported-ref:Research - Arc & Dev',
          },
        },
        claimPath: tmpDir,
        initializers: [],
        overrides: [],
        globals: [],
        normalizers: [],
      },
    };

    return renderClaims;
  }

  it('resolves imported-refs against previously imported CRs', async () => {
    const crs = {
      'FirestartrGithubMembership-user-b-uuid': makePreviousCR(
        'FirestartrGithubMembership',
        'user-b',
        'user-b',
      ),
      'FirestartrGithubGroup-research-arc-dev-uuid': makePreviousCR(
        'FirestartrGithubGroup',
        'Research - Arc & Dev',
        'research-arc-dev',
      ),
    };

    await renderFromImports(
      makeRenderClaim(),
      crs,
      path.join(tmpDir, 'catalog'),
      path.join(tmpDir, 'resources'),
    );

    const writtenFile = path.join(tmpDir, 'components', 'test-import.yaml');
    expect(fs.existsSync(writtenFile)).toBe(true);

    const written = YAML.parse(fs.readFileSync(writtenFile, 'utf8'));
    expect(written.spec.owner).toBe('user:user-b');
    expect(written.spec.parentTeam).toBe('group:research-arc-dev');
  });

  it('throws when an imported-ref cannot be resolved and crs is empty', async () => {
    await expect(
      renderFromImports(
        makeRenderClaim(),
        {},
        path.join(tmpDir, 'catalog'),
        path.join(tmpDir, 'resources'),
      ),
    ).rejects.toThrow(
      'Error while resolving imported-refs: Could not resolve imported-ref of type user with value user-b',
    );
  });
});

describe('renderFromImports stitching (fixture-based)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext({ onlyFiles: ['component_a'] });
  });

  afterEach(async () => {
    MOCK_STITCHING_FEATURES(undefined);
    await ctx.destroy();
  });

  async function makeFixtureRenderClaims(): Promise<RenderClaims> {
    const claim = ctx.fromYaml(await ctx.getFile('component_a'));
    return {
      [`ComponentClaim-${(claim as { name: string }).name}`]: {
        claim,
        claimPath: ctx.getClaimsDir(),
        initializers: [],
        overrides: [],
        globals: [],
        normalizers: [],
      },
    };
  }

  it('patches imported claims via claim stitching (escaped annotation key)', async () => {
    MOCK_STITCHING_FEATURES(async () => [
      {
        feature: 'tech_docs',
        patches: [
          {
            op: 'add',
            path: '/annotations/firestartr.dev~1techdocs',
            value: 'url:https://example',
          },
        ],
      },
    ]);

    const renderClaims = await makeFixtureRenderClaims();
    await renderFromImports(
      renderClaims,
      {},
      ctx.getCatalogOutDir(),
      ctx.getResourcesOutDir(),
    );

    const stitched = (renderClaims['ComponentClaim-component_a']
      .claim as any).annotations;
    expect(stitched['firestartr.dev/techdocs']).toBe('url:https://example');
  });

  it('does not re-stitch an already stitched claim (once-only)', async () => {
    let calls = 0;
    MOCK_STITCHING_FEATURES(async () => {
      calls++;
      return [
        {
          feature: 'tech_docs',
          patches: [{ op: 'add', path: '/annotations/again', value: '1' }],
        },
      ];
    });

    const renderClaims = await makeFixtureRenderClaims();
    await renderFromImports(
      renderClaims,
      {},
      ctx.getCatalogOutDir(),
      ctx.getResourcesOutDir(),
    );
    expect(calls).toBe(1);

    await renderFromImports(
      renderClaims,
      {},
      ctx.getCatalogOutDir(),
      ctx.getResourcesOutDir(),
    );
    expect(calls).toBe(1);
  });

  it('rejects malformed feature descriptors at the import boundary', async () => {
    await ctx.applyPatches('component_a', [
      {
        op: 'add',
        path: '/providers/github/features',
        value: [{ name: 'f', version: '1.0.0', repo: 'singleword' }],
      },
    ]);

    const renderClaims = await makeFixtureRenderClaims();
    await expect(
      renderFromImports(
        renderClaims,
        {},
        ctx.getCatalogOutDir(),
        ctx.getResourcesOutDir(),
      ),
    ).rejects.toThrow(/Invalid feature descriptor/);
  });
});