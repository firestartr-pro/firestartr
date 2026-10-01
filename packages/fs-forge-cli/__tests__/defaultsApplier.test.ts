import { describe, expect, it } from '@jest/globals';

import { applyClaimDefaults } from '../src/defaults/applier';

const DEFAULTS = {
  ComponentClaim: {
    platformOwner: 'group:firestartr-test-platform-team',
    providers: {
      github: {
        orgPermissions: 'none',
        technology: { stack: 'node', version: '14' },
        features: [],
      },
    },
  },
  TFWorkspaceClaim: {
    providers: {
      terraform: {
        module: 'github.com/example/module',
        sync: { enabled: true, period: '5m' },
      },
    },
  },
};

function github(result: Record<string, unknown>) {
  return (result.providers as { github: Record<string, unknown> }).github;
}

function terraform(result: Record<string, unknown>) {
  return (result.providers as { terraform: Record<string, unknown> }).terraform;
}

describe('applyClaimDefaults', () => {
  it('fills every field the claim does not define', () => {
    const claim = { kind: 'ComponentClaim', name: 'svc', owner: 'group:my-team' };

    expect(applyClaimDefaults(claim, DEFAULTS)).toEqual({
      kind: 'ComponentClaim',
      name: 'svc',
      owner: 'group:my-team',
      platformOwner: 'group:firestartr-test-platform-team',
      providers: {
        github: {
          orgPermissions: 'none',
          technology: { stack: 'node', version: '14' },
          features: [],
        },
      },
    });
  });

  it('never overwrites a value the claim defines', () => {
    const claim = {
      kind: 'ComponentClaim',
      name: 'svc',
      owner: 'group:my-team',
      platformOwner: 'group:custom',
      providers: {
        github: {
          orgPermissions: 'admin',
          technology: { stack: 'python' },
        },
      },
    };

    const result = applyClaimDefaults(claim, DEFAULTS);

    expect(result.platformOwner).toBe('group:custom');
    expect(github(result).orgPermissions).toBe('admin');
    // Nested filling is additive too: only the missing field is added
    expect(github(result).technology).toEqual({
      stack: 'python',
      version: '14',
    });
    expect(github(result).features).toEqual([]);
  });

  it('preserves a claim-level default block as-is (atomic)', () => {
    const claim = {
      kind: 'TFWorkspaceClaim',
      name: 'ws',
      owner: 'group:my-team',
      system: 'system:my-system',
      providers: {
        terraform: {
          name: 'ws',
          source: 'Inline',
          values: { configmap_name: 'my-config' },
          context: { providers: [{ name: 'kubernetes' }] },
          sync: { enabled: false },
        },
      },
    };

    const result = applyClaimDefaults(claim, DEFAULTS);

    // The whole block is preserved; no default field is merged inside it
    expect(terraform(result).sync).toEqual({ enabled: false });
    // Fields outside the block are still filled
    expect(terraform(result).module).toBe('github.com/example/module');
  });

  it('applies the whole default block when the claim defines none of it', () => {
    const claim = {
      kind: 'TFWorkspaceClaim',
      name: 'ws',
      owner: 'group:my-team',
      system: 'system:my-system',
      providers: {
        terraform: {
          name: 'ws',
          source: 'Inline',
          values: { configmap_name: 'my-config' },
          context: { providers: [{ name: 'kubernetes' }] },
        },
      },
    };

    const result = applyClaimDefaults(claim, DEFAULTS);

    expect(terraform(result).sync).toEqual({
      enabled: true,
      period: '5m',
    });
    expect(terraform(result).module).toBe('github.com/example/module');
  });

  it('returns the claim unchanged when its kind has no defaults', () => {
    const claim = { kind: 'UnknownClaim', name: 'x' };

    expect(applyClaimDefaults(claim, DEFAULTS)).toEqual(claim);
  });

  it('does not mutate the input claim', () => {
    const claim = {
      kind: 'ComponentClaim',
      name: 'svc',
      owner: 'group:my-team',
      providers: { github: { visibility: 'private' } },
    };
    const copy = structuredClone(claim);

    applyClaimDefaults(claim, DEFAULTS);

    expect(claim).toEqual(copy);
  });
});
