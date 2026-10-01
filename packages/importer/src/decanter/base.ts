import * as fs from 'fs';
import * as path from 'path';
import jsonpatch from 'fast-json-patch';

import common from 'catalog_common';
import github from 'github';
import {
  ImportInitializer,
  NeedsReImportInitializer,
  UUIDInitializer,
  NameNormalizer,
  InitializerClaimRef,
  InitializerDefault,
} from 'cdk8s_renderer';

import { getClaimsPath, getConfigPath } from './config';

import log from '../logger';

export default class Decanter {
  data: any = {};

  claimKind: string | undefined;

  static collectionKind = '';

  protected initializerInstances: any[] = [];

  claim: any = {};

  deps: { [key: string]: { cr: any; secret: any } } = {};

  _needsReImport = false;

  _postRenderFunctions: Function[] = [];

  _github: any = github;

  set github(githubInstance: any) {
    this._github = githubInstance;
  }

  get github() {
    return this._github;
  }

  set needsReImport(value: boolean) {
    this._needsReImport = value;
  }

  get needsReImport() {
    return this._needsReImport;
  }

  get postRenderFunctions() {
    return this._postRenderFunctions;
  }

  constructor(data: any) {
    this.data = data;
  }

  async __adaptInitializerTfStateKey() {
    return new UUIDInitializer();
  }

  async __adaptInitializerClaimRef() {
    return new InitializerClaimRef();
  }

  async __adaptInitializerImport() {
    return new ImportInitializer();
  }

  async __adaptInitializerNeedsReImport() {
    if (this.needsReImport) {
      return new NeedsReImportInitializer();
    }
  }

  __patchClaim(patch: any) {
    this.claim = jsonpatch.applyPatch(this.claim, [patch]).newDocument;
  }

  __patchCr(cr: any, patches: any) {
    patches = Array.isArray(patches) ? patches : [patches];

    return jsonpatch.applyPatch(cr, patches).newDocument;
  }

  __validateEqual(a: any, b: any) {
    return jsonpatch.compare(a, b).length === 0;
  }

  __decantStart() {}

  __getMethods(check: any): any[] {
    if (!check) return [];

    return Object.getOwnPropertyNames(check)
      .concat(this.__getMethods(Object.getPrototypeOf(check)))
      .reduce(
        (unique: any, item: any) =>
          unique.includes(item) ? unique : [...unique, item],
        [],
      );
  }

  async gather() {
    for (const method of this.__getMethods(this)) {
      if (
        method.match(/^__gather/) &&
        typeof (this as any)[method] === 'function'
      ) {
        await (this as any)[method]();
      }
    }
  }

  decant() {
    if (this['__decantStart']) this.__decantStart();

    for (const method of this.__getMethods(this)) {
      if (
        method.match(/^__decant/) &&
        typeof (this as any)[method] === 'function'
      ) {
        if (method === '__decantStart') continue;

        (this as any)[method]();
      }
    }

    return this._adapt();
  }

  validateCR(cr: any) {
    let isOk = true;

    for (const method in this.__getMethods(this)) {
      if (
        method.match(/^__validate/) &&
        typeof (this as any)[method] === 'function'
      ) {
        if (!(this as any)[method](cr)) {
          isOk = false;
          (this as any)[method]['KO' + method]();
        }
      }
    }

    return isOk;
  }

  render() {
    const yaml = common.io.toYaml(this.claim);

    const claimsPath = getClaimsPath();

    common.io.writeClaim(this.claim, claimsPath);

    return yaml;
  }

  postRender() {
    for (const method of this.__getMethods(this)) {
      if (
        method.match(/^__postRender/) &&
        typeof (this as any)[method] === 'function'
      ) {
        (this as any)[method]();
      }
    }
  }

  async _adapt() {
    const initializers: any[] = [];

    const overrides: any[] = [];

    const methods = this.__getMethods(this);

    for (const method of methods) {
      if (
        method.match(/^__adaptInitializer/) &&
        typeof (this as any)[method] === 'function'
      ) {
        const initializer = await (this as any)[method]();

        if (initializer) initializers.push(initializer);
      }

      if (
        method.match(/^__adaptOverrider/) &&
        typeof (this as any)[method] === 'function'
      ) {
        const overrider = await (this as any)[method]();

        if (overrider) overrides.push(overrider);
      }
    }

    const adapted = {
      deps: this.getDeps(),
      postRenderFunctions: this.postRenderFunctions,
      renderClaim: {
        claim: this.claim,
        claimPath: getClaimsPath(),
        initializers,
        globals: [],
        overrides,
        normalizers: [new NameNormalizer()],
      },
    };

    return adapted;
  }

  setDep(key: string, cr: any, secret: any) {
    if (!this.deps[key]) this.deps[key] = { cr, secret };
  }

  setPostRenderF(f: Function) {
    this._postRenderFunctions.push(f);
  }

  getDeps() {
    return this.deps;
  }

  VERSION() {
    return '1.0';
  }

  adapt() {
    return this._adapt();
  }

  async __loadInitializer(initDefaultPath: string, isAbsolute = false) {
    let initPath: string = initDefaultPath;

    try {
      if (!isAbsolute) {
        // Path construction may throw, so handle it separately
        try {
          initPath = path.join(getConfigPath(), 'resources', initDefaultPath);
        } catch (err) {
          log.error('Error constructing initializer path:', err);
          throw new Error(
            `Failed to construct initializer path for ${initDefaultPath}`,
          );
        }
      }

      const adapter = common.io.fromYaml(fs.readFileSync(initPath, 'utf-8'));
      return new InitializerDefault(adapter);
    } catch (e) {
      log.error(`Error loading initializer at ${initPath}:`, e);
      throw new Error(`Failed to load initializer at ${initPath}`);
    }
  }
}
