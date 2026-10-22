import type { Dependency, Dependencies } from './loader';

import { EntityCR } from '../entities/cr';

import { resolveRefIn } from './resolver';

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export class ResolvedRef {
  dep: Dependency;

  decodedSecret: any | null = null;

  entityCr: EntityCR;

  constructor(dep: Dependency, deps: Dependencies) {
    this.dep = dep;

    if ('cr' in this.dep && this.dep.cr) {
      // we create an EntityCR to handle a dep cr
      // but it has no self-outputs, thus, we go to
      // its own outputs (its secret)
      const selfOutputs = resolveRefIn(deps, {
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
    const outputs = this.secrets.outputs;

    // Indexing an ordinary object also finds inherited Object.prototype
    // members, so an absent key such as 'constructor' or 'toString' would
    // otherwise resolve to a function and reach provisioning as a valid
    // value. Only own properties are real outputs.
    if (!Object.prototype.hasOwnProperty.call(outputs, key)) {
      return undefined;
    }

    return outputs[key];
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

    const has = (obj: Record<string, any>, key: string) =>
      Object.prototype.hasOwnProperty.call(obj, key);

    for (const key in outputs) {
      if (!has(outputs, key)) continue;

      const value = outputs[key];

      if (isRecord(value) && has(value, 'value')) {
        flattened[key] = value.value;
      } else {
        flattened[key] = value;
      }
    }

    return flattened;
  }

  private normalizeOutputs(outputs: Record<string, any>): Record<string, any> {
    const normalized: Record<string, any> = { ...outputs };

    const has = (obj: Record<string, any>, key: string) =>
      Object.prototype.hasOwnProperty.call(obj, key);

    for (const key in outputs) {
      if (!has(outputs, key)) continue;

      const camelKey = this.toCamelCase(key);

      if (!has(normalized, camelKey)) {
        normalized[camelKey] = outputs[key];
      }
    }

    if (!has(normalized, 'id') && has(normalized, 'team_id')) {
      normalized.id = normalized.team_id;
    }

    if (!has(normalized, 'slug') && has(normalized, 'team_slug')) {
      normalized.slug = normalized.team_slug;
    }

    if (!has(normalized, 'nodeId') && has(normalized, 'node_id')) {
      normalized.nodeId = normalized.node_id;
    }

    return normalized;
  }

  private extractOutputs(value: any): Record<string, any> | null {
    if (!isRecord(value)) {
      return null;
    }

    const has = (obj: Record<string, any>, key: string) =>
      Object.prototype.hasOwnProperty.call(obj, key);

    if (has(value, 'outputs') && isRecord(value.outputs)) {
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
