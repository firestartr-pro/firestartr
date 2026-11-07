import { Entity, PatchOperations } from '../base';

import log from '../../logger';

import { provisionOrgSecrets, adoptSecretsIfNeeded } from './secrets';

import type { SecretEntry } from './secrets';
import type { Dependencies } from '../../refs';

export class EntityGHOrgSecretSection extends Entity {
  constructor(artifact: any, deps?: Dependencies) {
    super(
      artifact,
      {
        config: {
          org: '',
          actions: {},
          codespaces: {},
          dependabot: {},
          actions_sha256: {},
          codespaces_sha256: {},
          dependabot_sha256: {},
        },
      },
      deps,
    );
  }

  async loadResources(tfOp: string): Promise<void> {
    log.info(`[gh-provisioner] running ${tfOp} on ${this.k8sId}`);

    try {
      const cr = this.cr;
      const org = cr.spec.org;
      const secrets = cr.spec.secrets || {};

      this.patchData({
        op: PatchOperations.replace,
        path: '/config/org',
        value: org,
      });

      await provisionOrgSecrets(this, secrets);

      const redactedDoc = JSON.parse(
        JSON.stringify(this._document, (key, value) => {
          if (key === 'value' && typeof value === 'string') return '[REDACTED]';
          return typeof value === 'string' && value.length > 50
            ? '[REDACTED]'
            : value;
        }),
      );

      this.synthMessage(
        `[gh-provisioner] ${this.k8sId} config:\n${JSON.stringify(redactedDoc, null, 2)}`,
      );
      this.synthEnd(`[gh-provisioner] ${this.k8sId} loaded its data`);

      if (tfOp === 'apply') {
        await adoptSecretsIfNeeded(this, secrets);
      }

      log.debug(`[gh-provisioner] ${this.k8sId} loaded its data`);
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);

      log.error(
        `[gh-provisioner] ${this.k8sId} error loading resources: ${message}`,
      );

      throw new Error(
        `[gh-provisioner] ${this.k8sId} error loading resources: ${message}`,
      );
    }
  }

  async postProvision(_tfOp: string): Promise<void> {}

  async loadAddressesToImport(): Promise<void> {}
}
