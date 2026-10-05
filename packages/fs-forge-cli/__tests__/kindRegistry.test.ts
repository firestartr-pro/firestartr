import { describe, expect, it } from '@jest/globals';
import { readdir } from 'fs/promises';
import { join } from 'path';

import {
  CLAIM_KIND_OPTIONS,
  CLAIM_PATH_CAPABILITIES,
  KIND_CAPABILITIES,
  KIND_REGISTRY,
  isClaimKind,
  kindById,
  normalizeKind,
  resolveClaimReference,
} from '../src/claims/kindRegistry';
import { PREFLIGHT_KINDS } from '../src/commands/preflight';

const ROOT = process.cwd();

async function schemaKindOrder(): Promise<string[]> {
  return (await readdir(join(ROOT, 'schemas')))
    .filter((file) => file.endsWith('Claim.json'))
    .map((file) => file.replace(/\.json$/, ''))
    .sort();
}

describe('kind registry', () => {
  it('classifies every kind with generated metadata and CLI capabilities', async () => {
    expect(KIND_CAPABILITIES.map(({ kind }) => kind)).toEqual(
      await schemaKindOrder(),
    );

    for (const capability of KIND_CAPABILITIES) {
      expect(capability.id).not.toBe('');
      expect(capability.summary).not.toBe('');
      expect(capability.icon.emoji).not.toBe('');
      expect(capability.icon.ascii).not.toBe('');
      expect(KIND_REGISTRY[capability.kind]).toEqual(capability);

      expect(capability.claimsDirectory === null).toBe(
        CLAIM_PATH_CAPABILITIES[capability.kind].requiresExplicitPath,
      );
    }
  });

  it('keeps the claim path capabilities unchanged', () => {
    expect(CLAIM_PATH_CAPABILITIES).toEqual({
      ComponentClaim: { directory: 'components', requiresExplicitPath: false },
      GroupClaim: { directory: 'groups', requiresExplicitPath: false },
      UserClaim: { directory: 'users', requiresExplicitPath: false },
      SystemClaim: { directory: 'systems', requiresExplicitPath: false },
      DomainClaim: { directory: 'domains', requiresExplicitPath: false },
      OrgWebhookClaim: { directory: 'orgWebhook', requiresExplicitPath: false },
      OrgSettingsClaim: { directory: 'orgSettings', requiresExplicitPath: false },
      ArgoDeployClaim: { directory: 'argocd', requiresExplicitPath: false },
      TFWorkspaceClaim: { requiresExplicitPath: true },
      SecretsClaim: { requiresExplicitPath: true },
    });
  });

  it('classifies the catalog-only and preflight kinds', () => {
    expect(
      KIND_CAPABILITIES.filter(({ catalogOnly }) => catalogOnly).map(
        ({ kind }) => kind,
      ),
    ).toEqual(['DomainClaim', 'SystemClaim']);
    expect(PREFLIGHT_KINDS).toEqual({
      repo: 'ComponentClaim',
      team: 'GroupClaim',
      user: 'UserClaim',
      tfworkspace: 'TFWorkspaceClaim',
    });
    expect(Object.keys(PREFLIGHT_KINDS)).toEqual([
      'repo',
      'team',
      'user',
      'tfworkspace',
    ]);
  });

  it('offers the short id and the full kind as --kind options', () => {
    expect(CLAIM_KIND_OPTIONS).toEqual(
      KIND_CAPABILITIES.flatMap(({ id, kind }) => [id, kind]),
    );
    expect(CLAIM_KIND_OPTIONS.slice(0, 4)).toEqual([
      'argodeploy',
      'ArgoDeployClaim',
      'component',
      'ComponentClaim',
    ]);
  });

  it('normalises short ids and full kind names, and resolves only full references', () => {
    expect(normalizeKind('component')).toBe('ComponentClaim');
    expect(normalizeKind('ComponentClaim')).toBe('ComponentClaim');
    expect(normalizeKind('COMPONENTCLAIM')).toBe('ComponentClaim');
    expect(normalizeKind('nope')).toBeUndefined();

    expect(kindById('component')?.kind).toBe('ComponentClaim');
    expect(kindById('ComponentClaim')).toBeUndefined();
    expect(kindById('COMPONENT')?.kind).toBe('ComponentClaim');
    expect(kindById('ComponentClaim')).toBeUndefined();

    expect(isClaimKind('ComponentClaim')).toBe(true);
    expect(isClaimKind('component')).toBe(false);

    expect(resolveClaimReference('ComponentClaim-api')).toEqual({
      kind: 'ComponentClaim',
      name: 'api',
    });
    expect(resolveClaimReference('ComponentClaim-my-service')).toEqual({
      kind: 'ComponentClaim',
      name: 'my-service',
    });
    expect(resolveClaimReference('component-api')).toBeUndefined();
    expect(resolveClaimReference('-api')).toBeUndefined();
    expect(resolveClaimReference('ComponentClaim-')).toBeUndefined();
    expect(resolveClaimReference('foo-bar')).toBeUndefined();
  });
});
