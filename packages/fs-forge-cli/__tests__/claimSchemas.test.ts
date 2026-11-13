import { describe, expect, it } from '@jest/globals';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { buildCommandModel } from '../src/codegen/model';
import { isHiddenFlag } from '../src/schema/claimOverlay';
import {
  claimSchemasDir,
  listClaimKinds,
  loadClaimSchema,
} from '../src/schema/claimSchemas';

async function withSchemas(
  schemas: Record<string, unknown>,
  run: (dir: string) => void,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'fs-forge-schemas-'));
  try {
    for (const [kind, schema] of Object.entries(schemas)) {
      await writeFile(join(dir, `${kind}.json`), JSON.stringify(schema));
    }
    run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('claim schemas source', () => {
  it('resolves the published package and lists every claim kind', () => {
    expect(listClaimKinds(claimSchemasDir(process.cwd()))).toEqual([
      'ArgoDeployClaim',
      'ComponentClaim',
      'DomainClaim',
      'GroupClaim',
      'OrgSettingsClaim',
      'OrgWebhookClaim',
      'SecretsClaim',
      'SystemClaim',
      'TFWorkspaceClaim',
      'UserClaim',
    ]);
  });

  it('merges a patch into the node without dropping its sibling properties', async () => {
    await withSchemas(
      {
        DomainClaim: {
          type: 'object',
          properties: {
            providers: {
              type: 'object',
              properties: { github: { type: 'object' } },
            },
          },
        },
      },
      (dir) => {
        const providers = (
          loadClaimSchema(dir, 'DomainClaim').properties as Record<
            string,
            { properties: Record<string, unknown> }
          >
        ).providers;

        expect(Object.keys(providers.properties).sort()).toEqual([
          'catalog',
          'github',
        ]);
      },
    );
  });

  it('fails loudly when a patched path no longer exists', async () => {
    await withSchemas(
      { OrgSettingsClaim: { type: 'object', properties: {} } },
      (dir) => {
        expect(() => loadClaimSchema(dir, 'OrgSettingsClaim')).toThrow(
          'OrgSettingsClaim schema has no property at',
        );
      },
    );
  });
});

describe('isHiddenFlag', () => {
  it('hides a path and everything below it, and nothing else', () => {
    expect(isHiddenFlag('GroupClaim', 'providers.github.sync.enabled')).toBe(
      true,
    );
    expect(isHiddenFlag('GroupClaim', 'providers.github.tfStateKey')).toBe(
      true,
    );
    expect(isHiddenFlag('GroupClaim', 'providers.github.syncOther')).toBe(
      false,
    );
    expect(isHiddenFlag('GroupClaim', 'providers.github.org')).toBe(false);
    expect(isHiddenFlag('ComponentClaim', 'providers.github.tfStateKey')).toBe(
      false,
    );
  });

  it('keeps the terraform sync flags the CLI always exposed', () => {
    expect(isHiddenFlag('TFWorkspaceClaim', 'providers.terraform.sync.json')).toBe(
      true,
    );
    expect(
      isHiddenFlag('TFWorkspaceClaim', 'providers.terraform.sync.enabled'),
    ).toBe(false);
  });
});

describe('required flags covered by a JSON escape hatch', () => {
  function flag(kind: string, path: string) {
    const schema = loadClaimSchema(claimSchemasDir(process.cwd()), kind);
    return buildCommandModel(schema, kind).flagSpecs.find(
      (spec) => spec.path === path,
    );
  }

  it('leaves them to the schema validation, so the JSON can supply them', () => {
    expect(flag('SecretsClaim', 'providers.external_secrets.secretStore.name')).toMatchObject(
      { required: false, conditionalRequired: true },
    );
    expect(flag('SecretsClaim', 'providers.external_secrets.name')).toMatchObject(
      { required: false, conditionalRequired: true },
    );
  });

  it('keeps a requirement when the covering JSON flag is hidden', () => {
    expect(flag('ArgoDeployClaim', 'providers.argocd.name')).toMatchObject({
      required: true,
    });
    expect(flag('ArgoDeployClaim', 'providers.argocd.json')).toBeUndefined();
  });
});
