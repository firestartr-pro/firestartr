import { Entity, PatchOperations } from '../base';

import log from '../../logger';

export class EntityExample extends Entity {
  constructor(artifact: any) {
    super(artifact, { config: {} });
  }

  async loadResources(tfOp: string): Promise<void> {
    log.info(`[gh-provisioner] running ${tfOp} on ${this.k8sId}`);

    try {
      this.patchData({
        path: '/config',
        op: PatchOperations.replace,
        value: {
          // exact TFM config keys from this.cr.spec
        },
      });

      log.debug(`[gh-provisioner] ${this.k8sId} loaded its data`);
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`[gh-provisioner] ${this.k8sId} error loading resources: ${message}`);
      throw new Error(`[gh-provisioner] ${this.k8sId} error loading resources: ${message}`);
    }
  }

  async postProvision(tfOp: string): Promise<void> {}

  async loadAddressesToImport(): Promise<void> {
    // add patchImportData only after confirming resource address and import id format
  }
}
