import type { StatusProjection } from './types';

interface TombstoneEntry {
  projection: StatusProjection;
  expiresAt: number;
}

export class StatusCache {
  private live: Map<string, StatusProjection> = new Map();
  private tombstones: Map<string, TombstoneEntry> = new Map();
  private claimRefIndex: Map<string, string[]> = new Map();

  private cacheKey(kind: string, name: string): string {
    return `${kind}/${name}`;
  }

  private claimRefKey(claimKind: string, claimName: string): string {
    return `${claimKind}/${claimName}`;
  }

  private indexClaimRef(projection: StatusProjection, cacheKey: string): void {
    if (!projection.claimKind || !projection.claimName) return;
    const key = this.claimRefKey(projection.claimKind, projection.claimName);
    const existing = this.claimRefIndex.get(key) || [];
    if (!existing.includes(cacheKey)) {
      existing.push(cacheKey);
      this.claimRefIndex.set(key, existing);
    }
  }

  private unindexClaimRef(
    projection: StatusProjection,
    cacheKey: string,
  ): void {
    if (!projection.claimKind || !projection.claimName) return;
    const key = this.claimRefKey(projection.claimKind, projection.claimName);
    const existing = this.claimRefIndex.get(key);
    if (!existing) return;
    const filtered = existing.filter((k) => k !== cacheKey);
    if (filtered.length === 0) {
      this.claimRefIndex.delete(key);
    } else {
      this.claimRefIndex.set(key, filtered);
    }
  }

  upsert(kind: string, name: string, projection: StatusProjection): void {
    const key = this.cacheKey(kind, name);
    const oldProjection = this.live.get(key);
    if (oldProjection) {
      this.unindexClaimRef(oldProjection, key);
    }
    this.tombstones.delete(key);
    this.live.set(key, projection);
    this.indexClaimRef(projection, key);
  }

  delete(kind: string, name: string, tombstoneTtlMs: number): void {
    const key = this.cacheKey(kind, name);
    const projection = this.live.get(key);
    if (!projection) return;
    this.unindexClaimRef(projection, key);
    this.live.delete(key);
    const tombstoneProjection = {
      ...projection,
      phase: 'DELETED' as const,
      observedAt: new Date().toISOString(),
    };
    this.tombstones.set(key, {
      projection: tombstoneProjection,
      expiresAt: Date.now() + tombstoneTtlMs,
    });
    this.indexClaimRef(tombstoneProjection, key);
  }

  getByClaimRef(claimKind: string, claimName: string): StatusProjection[] {
    this.evictExpiredTombstones();
    const key = this.claimRefKey(claimKind, claimName);
    const crKeys = this.claimRefIndex.get(key);
    if (!crKeys || crKeys.length === 0) return [];
    const results: StatusProjection[] = [];
    for (const crKey of crKeys) {
      const live = this.live.get(crKey);
      if (live) {
        results.push(live);
      } else {
        const tombstone = this.tombstones.get(crKey);
        if (tombstone) {
          results.push(tombstone.projection);
        }
      }
    }
    return results;
  }

  getAll(): StatusProjection[] {
    this.evictExpiredTombstones();
    const results: StatusProjection[] = [];
    for (const projection of this.live.values()) {
      results.push(projection);
    }
    for (const entry of this.tombstones.values()) {
      results.push(entry.projection);
    }
    return results;
  }

  getSize(): { live: number; tombstones: number } {
    return {
      live: this.live.size,
      tombstones: this.tombstones.size,
    };
  }

  private evictExpiredTombstones(): void {
    const now = Date.now();
    for (const [key, entry] of this.tombstones.entries()) {
      if (now >= entry.expiresAt) {
        const oldProjection = entry.projection;
        this.unindexClaimRef(oldProjection, key);
        this.tombstones.delete(key);
      }
    }
  }
}
