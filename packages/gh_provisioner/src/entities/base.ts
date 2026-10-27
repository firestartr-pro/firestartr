import fastJsonPatch from 'fast-json-patch';

import { Operation } from 'fast-json-patch';

import { EntityCR } from './cr';

import log from '../logger';

import type { Dependencies, Ref, ResolvedRef } from '../refs';

import { resolveRefIn } from '../refs';

import { getFirestartrDefaultTFM } from '../terraform';

import { withEnv } from '../utils';

const TERRAFORM_MODULE_ANNOTATION = 'firestartr.dev/terraform-module';
const IS_DEBUG_MODE_ANNOTATION = 'firestartr.dev/gh-debug';

enum PatchOperations {
  add = 'add',
  replace = 'replace',
  remove = 'remove',
}

type PatchData = {
  path: string;
  op: PatchOperations;
  value?: any;
};

export { PatchOperations, PatchData };

export abstract class Entity {
  // Optional pointer to parent Entity for session propagation
  parent?: Entity;

  // Session-aware local TF tracking: populated by runGhProvisioner
  _terraformHasRun?: boolean;

  // Workspace preservation session fields
  sessionId?: string;
  sessionProjectPath?: string;
  __ghProvisionerSessionWorkspaceInitialized?: boolean;

  _cr: EntityCR;

  _document: any = null;

  _importDocument: any = {
    imports: [],
  };

  // Addresses an artifact plan leaves out, to model state cleanup that the
  // live operation would do first (e.g. `state rm`), without touching state
  planExcludes: string[] = [];

  // Timeout controller of this run: every Terraform call the entity makes,
  // including state discovery, is bounded by it
  tfCtl: any = undefined;

  // Dependencies of this execution only: every ref this entity resolves
  // is looked up here, never in module state.
  _deps: Dependencies = {};

  _streamGHProvisioner: any = null;
  _streamTFProvisioner: any = null;

  constructor(artifact: any, document?: any, deps?: Dependencies) {
    this._document = document || {};

    this._deps = deps ?? {};

    // we pass the artifact
    // a resolutor to self-outputs (self-outputs is not present in the
    // CREATED op)
    const selfOutputs = this.resolveRef({
      kind: 'self',
      name: 'outputs',
    });

    this._cr = new EntityCR(artifact, (key: string) => {
      return selfOutputs && selfOutputs.getOutput(key);
    });

    log.info(
      `[gh-provisioner] ${this.k8sId} bound ${Object.keys(this._deps).length} dependencies`,
    );
  }

  resolveRef(ref: Ref): ResolvedRef | null {
    return resolveRefIn(this._deps, ref);
  }

  /**
   * Resolves a ref this execution cannot work without. An unresolved ref
   * throws a readable error here instead of surfacing later as a TypeError
   * from a null dereference.
   */
  requireRef(ref: Ref): ResolvedRef {
    const resolved = this.resolveRef(ref);

    if (!resolved) {
      throw new Error(
        `[gh-provisioner] ${this.k8sId} could not resolve ${ref.kind}/${ref.name} ref from its dependencies`,
      );
    }

    return resolved;
  }

  /**
   * Resolves a ref and one of its required outputs. Throws a readable error
   * when either the ref itself or the output key is absent, instead of
   * provisioning `undefined`.
   */
  requireOutput(ref: Ref, key: string): any {
    const resolved = this.requireRef(ref);

    const value = resolved.getOutput(key);

    if (value === undefined) {
      throw new Error(
        `[gh-provisioner] ${this.k8sId} could not resolve output '${key}' of ${ref.kind}/${ref.name} from its dependencies`,
      );
    }

    return value;
  }

  abstract loadResources(tfOp: string): Promise<void>;

  abstract postProvision(tfOp: string): Promise<void>;

  abstract loadAddressesToImport(): Promise<void>;

  patchData(patch: PatchData) {
    log.debug(`patch ${JSON.stringify(patch)}`);

    this._document = fastJsonPatch.applyPatch(this._document, [
      patch as Operation,
    ]).newDocument;
  }

  patchImportData(patch: PatchData) {
    log.debug(`import data patch ${JSON.stringify(patch)}`);

    this._importDocument = fastJsonPatch.applyPatch(this._importDocument, [
      patch as Operation,
    ]).newDocument;
  }

  // streams
  set streamGHProvisioner(logStreamCallbacksGHProvisioner: any) {
    this._streamGHProvisioner = logStreamCallbacksGHProvisioner;
  }

  get streamGHProvisioner() {
    return this._streamGHProvisioner;
  }

  set streamTFProvisioner(logStreamCallbacksTF: any) {
    this._streamTFProvisioner = logStreamCallbacksTF;
  }

  get streamTFProvisioner() {
    return this._streamTFProvisioner;
  }

  synthMessage(msg: string) {
    if (this.streamGHProvisioner)
      this.streamGHProvisioner.fnData('\n' + msg + '\n');
  }

  synthEnd(msg: string) {
    this.synthMessage(msg);

    if (this.streamGHProvisioner) this.streamGHProvisioner.fnEnd();
  }

  synthError(msg: string) {
    this.synthMessage(`Error: \n ${msg}`);

    if (this.streamGHProvisioner) this.streamGHProvisioner.fnOnError();
  }

  // load preparer
  async prepareToLoad(tfOp: string) {
    const tfModule = this.terraformModule;

    this.synthMessage(`
 ----------------------------------------------------------------------------------
  Entity: ${this.cr.kind} / ${this.cr.name}
  Operation: ${tfOp}
  Terraform Module: ${typeof tfModule === 'string' ? tfModule : tfModule.module + '?ref=' + tfModule.ref}
  Starting time: ${new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Madrid' })}
 ----------------------------------------------------------------------------------`);
  }

  get document() {
    // we always make a deep copy to avoid
    // uncontrolled changes

    log.silly(`Document: ${JSON.stringify(this._document)}`);

    return JSON.parse(JSON.stringify(this._document));
  }

  get importDocument() {
    log.silly(`Document: ${JSON.stringify(this._importDocument)}`);

    return JSON.parse(JSON.stringify(this._importDocument));
  }

  get k8sId() {
    return `${this.cr.kind}/${this.cr.name}`;
  }

  get cr() {
    return this._cr;
  }

  get tfStateKey() {
    return this.cr.spec.firestartr.tfStateKey;
  }
  get inDebugMode() {
    return (
      IS_DEBUG_MODE_ANNOTATION in this.cr.annotations &&
      this.cr.annotations[IS_DEBUG_MODE_ANNOTATION] === '1'
    );
  }

  get terraformModule() {
    if (TERRAFORM_MODULE_ANNOTATION in this.cr.annotations) {
      return this.cr.annotations[TERRAFORM_MODULE_ANNOTATION];
    } else {
      return getFirestartrDefaultTFM(this.cr.kind);
    }
  }

  get terraformModuleAsURL() {
    const tfm = this.terraformModule;

    if (typeof tfm === 'string') return tfm;
    else return `${tfm.module}?ref=${tfm.ref}`;
  }

  get backend() {
    return this.requireRef(this.cr.spec.context.backend.ref);
  }

  get provider() {
    return this.requireRef(this.cr.spec.context.provider.ref);
  }

  async runWithGithubProvider(fn: Function) {
    const envGH = this.githubGithubProviderCredentials;

    return await withEnv(envGH, fn, { replace: false });
  }

  get githubGithubProviderCredentials() {
    const providerRef = this.provider;

    const envGH = {};

    for (const name in providerRef.cr.spec.secrets) {
      const secretRef = providerRef.cr.spec.secrets[name].secretRef;

      envGH[name] = this.requireOutput(
        { ...secretRef, kind: 'Secret' },
        secretRef.key,
      );
    }

    return envGH;
  }
}
