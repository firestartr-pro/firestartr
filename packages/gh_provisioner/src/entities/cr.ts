const EXTERNAL_NAME_ANNOTATION = 'firestartr.dev/external-name';
const IMPORT_ID_ANNOTATION = 'firestartr.dev/github-id';

export class EntityCR {
  kind: string;

  apiVersion: string;

  metadata: any;

  spec: any;

  rawCr: any;

  fResolveSelfOutputs: Function;

  constructor(cr: any, resolveSelfOutputs: Function) {
    this.rawCr = cr;

    this.kind = cr.kind;

    this.apiVersion = cr.apiVersion;

    this.spec = cr.spec;

    this.metadata = cr.metadata;

    this.fResolveSelfOutputs = resolveSelfOutputs;
  }

  get name() {
    if (EXTERNAL_NAME_ANNOTATION in this.annotations) {
      return this.annotations[EXTERNAL_NAME_ANNOTATION];
    } else {
      return this.metadata.name;
    }
  }

  get slug() {
    // we search the slug in the outputs
    const slug = this.fResolveSelfOutputs('slug');

    if (slug) {
      // is the slug in the outputs?
      return slug;
    } else {
      return undefined;
    }
  }

  get externalName() {
    return this.annotations[EXTERNAL_NAME_ANNOTATION];
  }

  get id() {
    // we search the id in the outputs
    const id = this.fResolveSelfOutputs('id');

    // if we are in an import process
    // there should be an id annotation
    // it takes always precedence
    if (IMPORT_ID_ANNOTATION in this.annotations) {
      return this.annotations[IMPORT_ID_ANNOTATION];
    } else if (id) {
      // is the ID in the outputs?
      return id;
    } else {
      return undefined;
    }
  }

  get annotations() {
    return this.metadata?.annotations || {};
  }
}
