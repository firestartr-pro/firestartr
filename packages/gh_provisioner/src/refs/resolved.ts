import type { Dependency } from './loader';

import { EntityCR, Entity } from '../entities';

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export class ResolvedRef {
  dep: Dependency;

  decodedSecret: any | null = null;

  entityCr: EntityCR;

  constructor(dep: Dependency) {
    this.dep = dep;

    if ('cr' in this.dep && this.dep.cr) {
      // we create an EntityCR to handle a dep cr
      // but it has no self-outputs, thus, we go to
      // its own outputs (its secret)
      const selfOutputs = Entity.refResolver({
        kind: 'Secret',
        name: `${this.dep.cr.name}-outputs`,
      });

      this.entityCr = new EntityCR(
        dep.cr,

        (key: string) => {
          return selfOutputs && selfOutputs.getOutput(key);
        },
      );
    }
  }

  getDepName() {
    return this.entityCr.name;
  }

  getOutput(key: string) {
    return this.secrets.outputs[key];
  }

  get cr() {
    return this.dep.cr;
  }

  private parseJson(value: string): any | null {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  private toCamelCase(value: string): string {
    return value.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  }

  private flattenOutputs(outputs: Record<string, any>): Record<string, any> {
    const flattened: Record<string, any> = {};

    for (const key in outputs) {
      const value = outputs[key];

      if (isRecord(value) && 'value' in value) {
        flattened[key] = value.value;
      } else {
        flattened[key] = value;
      }
    }

    return flattened;
  }

  private normalizeOutputs(outputs: Record<string, any>): Record<string, any> {
    const normalized: Record<string, any> = { ...outputs };

    for (const key in outputs) {
      const camelKey = this.toCamelCase(key);

      if (!(camelKey in normalized)) {
        normalized[camelKey] = outputs[key];
      }
    }

    if (!('id' in normalized) && 'team_id' in normalized) {
      normalized.id = normalized.team_id;
    }

    if (!('slug' in normalized) && 'team_slug' in normalized) {
      normalized.slug = normalized.team_slug;
    }

    if (!('nodeId' in normalized) && 'node_id' in normalized) {
      normalized.nodeId = normalized.node_id;
    }

    return normalized;
  }

  private extractOutputs(value: any): Record<string, any> | null {
    if (!isRecord(value)) {
      return null;
    }

    if ('outputs' in value && isRecord(value.outputs)) {
      return this.normalizeOutputs(this.flattenOutputs(value.outputs));
    }

    return this.normalizeOutputs(this.flattenOutputs(value));
  }

  private decodeBase64Value(value: string): string {
    return Buffer.from(value, 'base64').toString('utf8');
  }

  get secrets() {
    if (!this.decodedSecret) {
      const base = this.dep.secret ? this.dep.secret : this.dep.cr;

      const outputs: Record<string, any> = {};

      if (typeof base.data === 'string') {
        const decoded = this.decodeBase64Value(base.data);
        const parsed = this.parseJson(decoded);
        const extracted = this.extractOutputs(parsed);

        if (extracted) {
          Object.assign(outputs, extracted);
        }
      } else {
        for (const key in base.data) {
          const decoded = this.decodeBase64Value(base.data[key]);

          if (key === 'outputs') {
            const parsed = this.parseJson(decoded);
            const extracted = this.extractOutputs(parsed);

            if (extracted) {
              Object.assign(outputs, extracted);
              continue;
            }
          }

          outputs[key] = decoded;
        }
      }

      this.decodedSecret = {
        outputs: this.normalizeOutputs(outputs),
      };
    }

    return this.decodedSecret;
  }
}
