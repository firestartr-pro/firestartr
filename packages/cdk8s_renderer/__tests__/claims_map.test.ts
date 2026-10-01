import path from 'path';
import fs from 'fs';
import os from 'os';
import common from 'catalog_common';

import { generateClaimsMap } from '../src/utils/claimUtils';
import { createTestContext } from './auxiliar';

describe('generateClaimsMap', () => {
  let ctx: any;

  beforeAll(async () => {
    ctx = await createTestContext({});
  });

  afterAll(async () => {
    await ctx.destroy();
  });

  it('produces all claims with correct relative paths', async () => {
    const outputPath = path.join(os.tmpdir(), 'claims-map-all-test.json');

    await generateClaimsMap(await ctx.getClaimsDir(), outputPath);

    const raw = fs.readFileSync(outputPath, 'utf-8');
    const map = JSON.parse(raw);

    expect(map.headers).toBeDefined();
    expect(typeof map.headers.sha).toBe('string');

    const expectedClaims: Record<string, string> = {
      'ComponentClaim-component_a': 'base_claims/components/component_a.yaml',
      'GroupClaim-group_a': 'base_claims/groups/group_a.yaml',
      'GroupClaim-group_b': 'base_claims/groups/group_b.yaml',
      'GroupClaim-group_c': 'base_claims/groups/group_c.yaml',
      'GroupClaim-firestartr': 'base_claims/groups/firestartr.yaml',
      'UserClaim-user_a': 'base_claims/users/user_a.yaml',
      'OrgSettingsClaim-github_org_settings': 'base_claims/orgSettings/orgsettings_a.yaml',
      'OrgSettingsClaim-github_org_settings_vars': 'base_claims/orgSettings/orgsettings_vars_a.yaml',
      'OrgWebhookClaim-orgwebhook_a': 'base_claims/orgWebhook/orgwebhook_a.yaml',
      'SystemClaim-system_a': 'base_claims/systems/system_a.yaml',
      'SecretsClaim-secret_a': 'base_claims/secrets/secret_a.yaml',
      'DomainClaim-domain_a': 'base_claims/domains/domain_a.yaml',
      'ArgoDeployClaim-redis-deploy': 'base_claims/argocd/argodeploy_a.yaml',
      'TFWorkspaceClaim-tfworkspace_a': 'base_claims/tfworkspaces/tfworkspace_a.yaml',
      'TFWorkspaceClaim-workspace_a': 'base_claims/tfworkspaces/workspace_a.yaml',
      'TFWorkspaceClaim-workspace_b': 'base_claims/tfworkspaces/workspace_b.yaml',
      'TFWorkspaceClaim-workspace_c': 'base_claims/tfworkspaces/workspace_c/workspace_c.yaml',
      'TFWorkspaceClaim-tfworkspace_variants': 'base_claims/tfworkspaces/tfworkspace_variants.yaml',
    };

    expect(Object.keys(map.claims).length).toBe(Object.keys(expectedClaims).length);

    for (const [ref, expectedPath] of Object.entries(expectedClaims)) {
      expect(map.claims[ref]).toBeDefined();
      expect(map.claims[ref].filePath).toBe(expectedPath);
    }

    expect(
      map.claims['TFWorkspaceClaim-workspace_a'].refs,
    ).toEqual(['TFWorkspaceClaim-workspace_b']);
    expect(map.claims['TFWorkspaceClaim-workspace_b'].refs).toEqual([]);
    expect(map.claims['TFWorkspaceClaim-tfworkspace_a'].refs).toEqual([]);
    expect(map.claims['ComponentClaim-component_a'].refs).toBeUndefined();
  });

  it('accepts a custom sha in headers', async () => {
    const outputPath = path.join(os.tmpdir(), 'claims-map-sha-test.json');

    await generateClaimsMap(await ctx.getClaimsDir(), outputPath, 'abc123');

    const raw = fs.readFileSync(outputPath, 'utf-8');
    const map = JSON.parse(raw);

    expect(map.headers.sha).toBe('abc123');
  });

  it('sets empty sha when not provided', async () => {
    const outputPath = path.join(os.tmpdir(), 'claims-map-nosha-test.json');

    await generateClaimsMap(await ctx.getClaimsDir(), outputPath);

    const raw = fs.readFileSync(outputPath, 'utf-8');
    const map = JSON.parse(raw);

    expect(map.headers.sha).toBe('');
  });

  it('skips YAML documents that are not objects', async () => {
    const outputPath = path.join(os.tmpdir(), 'claims-map-scalar-test.json');
    const fromYaml = jest.spyOn(common.io, 'fromYaml').mockReturnValue('invalid');

    try {
      await generateClaimsMap(await ctx.getClaimsDir(), outputPath);
      const map = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));

      expect(map.claims).toEqual({});
    } finally {
      fromYaml.mockRestore();
    }
  });

  it('skips claims with invalid kind or name values', async () => {
    const outputPath = path.join(os.tmpdir(), 'claims-map-identity-test.json');
    const fromYaml = jest
      .spyOn(common.io, 'fromYaml')
      .mockReturnValue({ kind: '', name: 1 });

    try {
      await generateClaimsMap(await ctx.getClaimsDir(), outputPath);
      const map = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));

      expect(map.claims).toEqual({});
    } finally {
      fromYaml.mockRestore();
    }
  });

  it('rejects duplicate claim references', async () => {
    await ctx.duplicateFile('component_a', 'component_duplicate');

    try {
      await expect(
        generateClaimsMap(
          await ctx.getClaimsDir(),
          path.join(os.tmpdir(), 'claims-map-duplicate-test.json'),
        ),
      ).rejects.toThrow(
        'Duplicate claim reference: ComponentClaim-component_a',
      );
    } finally {
      await ctx.removeFile('component_duplicate');
    }
  });

  it('deduplicates TFWorkspace refs when same workspace is referenced multiple times', async () => {
    await ctx.applyPatches('workspace_a', [
      {
        op: 'add',
        path: '/providers/terraform/values/second_ref',
        value: '${{ tfworkspace:workspace_b:outputs.region }}',
      },
    ]);

    const outputPath = path.join(
      os.tmpdir(),
      'claims-map-dedup-refs-test.json',
    );

    await generateClaimsMap(await ctx.getClaimsDir(), outputPath);

    const raw = fs.readFileSync(outputPath, 'utf-8');
    const map = JSON.parse(raw);

    expect(map.claims['TFWorkspaceClaim-workspace_a'].refs).toEqual([
      'TFWorkspaceClaim-workspace_b',
    ]);
  });

  it('produces an empty map for an empty directory', async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-claims-'));
    const outputPath = path.join(os.tmpdir(), 'claims-map-empty-test.json');

    await generateClaimsMap(emptyDir, outputPath);

    const raw = fs.readFileSync(outputPath, 'utf-8');
    const map = JSON.parse(raw);

    expect(map.headers.sha).toBe('');
    expect(map.claims).toEqual({});
  });
});
