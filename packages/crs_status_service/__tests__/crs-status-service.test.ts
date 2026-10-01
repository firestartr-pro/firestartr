import { StatusCache } from '../src/cache';
import type { StatusProjection } from '../src/types';

function makeProjection(
  overrides: Partial<StatusProjection> = {},
): StatusProjection {
  return {
    kind: 'FirestartrDummyA',
    name: 'test-cr',
    namespace: 'firestartr',
    claimKind: 'Component',
    claimName: 'test-component',
    phase: 'SYNCHRONIZED',
    conditions: [
      {
        type: 'SYNCHRONIZED',
        status: 'True',
        reason: 'ReconciliationSucceeded',
        message: 'All resources are up to date',
        lastTransitionTime: '2025-01-01T00:00:00Z',
      },
    ],
    observedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('StatusCache', () => {
  let cache: StatusCache;

  beforeEach(() => {
    cache = new StatusCache();
  });

  describe('upsert', () => {
    it('stores a projection and makes it retrievable by claim-ref', () => {
      const projection = makeProjection();
      cache.upsert(projection.kind, projection.name, projection);
      const results = cache.getByClaimRef('Component', 'test-component');
      expect(results).toHaveLength(1);
      expect(results[0].phase).toBe('SYNCHRONIZED');
    });

    it('returns an empty array for a claim-ref that has no CRs', () => {
      const results = cache.getByClaimRef('Component', 'nonexistent');
      expect(results).toEqual([]);
    });

    it('stores multiple CRs for the same claim-ref', () => {
      const p1 = makeProjection({ name: 'cr-one', claimName: 'my-component' });
      const p2 = makeProjection({ name: 'cr-two', claimName: 'my-component' });
      cache.upsert(p1.kind, p1.name, p1);
      cache.upsert(p2.kind, p2.name, p2);
      const results = cache.getByClaimRef('Component', 'my-component');
      expect(results).toHaveLength(2);
    });

    it('stores CRs without a claim-ref as orphans (not in claim-ref index)', () => {
      const orphan = makeProjection({ claimKind: null, claimName: null });
      cache.upsert(orphan.kind, orphan.name, orphan);
      const results = cache.getByClaimRef('Component', 'test-component');
      expect(results).toEqual([]);
    });

    it('updates an existing projection and returns new values', () => {
      const p1 = makeProjection({ phase: 'PROVISIONING' });
      cache.upsert(p1.kind, p1.name, p1);
      const p2 = makeProjection({ phase: 'SYNCHRONIZED' });
      cache.upsert(p2.kind, p2.name, p2);
      const results = cache.getByClaimRef('Component', 'test-component');
      expect(results).toHaveLength(1);
      expect(results[0].phase).toBe('SYNCHRONIZED');
    });
  });

  describe('delete (tombstone)', () => {
    it('retains the CR as DELETED within TTL', () => {
      const projection = makeProjection();
      cache.upsert(projection.kind, projection.name, projection);
      cache.delete(projection.kind, projection.name, 60000);
      const results = cache.getByClaimRef('Component', 'test-component');
      expect(results).toHaveLength(1);
      expect(results[0].phase).toBe('DELETED');
    });

    it('evicts the tombstone after TTL expires', () => {
      const projection = makeProjection();
      cache.upsert(projection.kind, projection.name, projection);
      cache.delete(projection.kind, projection.name, 0);
      const results = cache.getByClaimRef('Component', 'test-component');
      expect(results).toEqual([]);
    });

    it('recreate supersedes tombstone (add after delete)', () => {
      const projection = makeProjection();
      cache.upsert(projection.kind, projection.name, projection);
      cache.delete(projection.kind, projection.name, 60000);
      const p2 = makeProjection({ phase: 'PROVISIONED' });
      cache.upsert(p2.kind, p2.name, p2);
      const results = cache.getByClaimRef('Component', 'test-component');
      expect(results).toHaveLength(1);
      expect(results[0].phase).toBe('PROVISIONED');
    });
  });

  describe('getAll', () => {
    it('returns all live and tombstone CRs', () => {
      cache.upsert(
        'KindA',
        'cr-one',
        makeProjection({ kind: 'KindA', name: 'cr-one', claimName: 'comp-a' }),
      );
      cache.upsert(
        'KindB',
        'cr-two',
        makeProjection({ kind: 'KindB', name: 'cr-two', claimName: 'comp-b' }),
      );
      cache.delete('KindA', 'cr-one', 60000);
      const all = cache.getAll();
      expect(all).toHaveLength(2);
      const deleted = all.find((p) => p.name === 'cr-one');
      expect(deleted?.phase).toBe('DELETED');
    });

    it('includes orphans (CRs without claim-ref)', () => {
      const orphan = makeProjection({
        claimKind: null,
        claimName: null,
        name: 'orphan-cr',
      });
      cache.upsert(orphan.kind, orphan.name, orphan);
      const all = cache.getAll();
      expect(all).toHaveLength(1);
    });
  });

  describe('phase pass-through', () => {
    const phases = [
      'ERROR',
      'PROVISIONING',
      'OUT_OF_SYNC',
      'PLANNING',
      'DELETING',
      'SYNCHRONIZED',
      'PROVISIONED',
      'UNKNOWN',
    ];

    for (const phase of phases) {
      it(`passes through phase '${phase}' verbatim`, () => {
        const projection = makeProjection({ phase });
        cache.upsert(projection.kind, projection.name, projection);
        const results = cache.getByClaimRef('Component', 'test-component');
        expect(results[0].phase).toBe(phase);
      });
    }
  });

  describe('recovery transitions', () => {
    it('transitions from OUT_OF_SYNC to PROVISIONED', () => {
      const projection = makeProjection({ phase: 'OUT_OF_SYNC' });
      cache.upsert(projection.kind, projection.name, projection);
      expect(cache.getByClaimRef('Component', 'test-component')[0].phase).toBe(
        'OUT_OF_SYNC',
      );
      const updated = makeProjection({ phase: 'PROVISIONED' });
      cache.upsert(updated.kind, updated.name, updated);
      expect(cache.getByClaimRef('Component', 'test-component')[0].phase).toBe(
        'PROVISIONED',
      );
    });
  });

  describe('claim-ref change', () => {
    it('handles changing claim-ref on an existing CR', () => {
      const p1 = makeProjection({ claimName: 'old-component' });
      cache.upsert(p1.kind, p1.name, p1);
      expect(cache.getByClaimRef('Component', 'old-component')).toHaveLength(1);
      expect(cache.getByClaimRef('Component', 'new-component')).toHaveLength(0);
      const p2 = makeProjection({ claimName: 'new-component' });
      cache.upsert(p2.kind, p2.name, p2);
      expect(cache.getByClaimRef('Component', 'old-component')).toHaveLength(0);
      expect(cache.getByClaimRef('Component', 'new-component')).toHaveLength(1);
    });
  });

  describe('getSize', () => {
    it('returns live and tombstone counts', () => {
      cache.upsert(
        'KindA',
        'cr-one',
        makeProjection({ kind: 'KindA', name: 'cr-one' }),
      );
      cache.upsert(
        'KindA',
        'cr-two',
        makeProjection({ kind: 'KindA', name: 'cr-two' }),
      );
      cache.delete('KindA', 'cr-one', 60000);
      const size = cache.getSize();
      expect(size.live).toBe(1);
      expect(size.tombstones).toBe(1);
    });
  });
});
