import { Entity, PatchOperations } from '../base';

import log from '../../logger';

import { provisionRepositorySecrets } from './secrets';

export class EntityGHRepositorySecretsSection extends Entity {
  constructor(artifact: any) {
    super(artifact, {
      config: {
        actions: {},
        codespaces: {},
        dependabot: {},
        actions_sha256: {},
        codespaces_sha256: {},
        dependabot_sha256: {},
      },
    });
  }

  async loadResources(tfOp: string): Promise<void> {
    try {
      const repo = Entity.refResolver(this.cr.spec.repositoryTarget.ref);

      await provisionRepositorySecrets(this, repo);

      this.patchData({
        path: '/config/repository',

        op: PatchOperations.add,

        value: `${repo.cr.spec.org}/${repo.getDepName()}`,
      });

      this.synthMessage('Synth finished');

      // we must not show the encrypted secret!!!!
      this.synthEnd(
        JSON.stringify(
          this.document,
          (key, value) => {
            if (typeof value === 'string') {
              if (value.length > 50) {
                return '[REDACTED]';
              }
            } else {
              return value;
            }
          },
          2,
        ),
      );
    } catch (err) {
      log.error(
        `[gh-provisioner] ${this.k8sId} error loading resources: ${err}`,
      );

      throw `[gh-provisioner] ${this.k8sId} error loading resources: ${err}`;
    }
  }

  async postProvision(): Promise<void> {}

  async loadAddressesToImport(): Promise<void> {}

  actionsSecret() {
    return (data: any) => {
      this.patchData({
        path: `/config/actions/${data.secretName}`,
        op: PatchOperations.add,
        value: data.encryptedValue,
      });
    };
  }

  codespacesSecret() {
    return (data: any) => {
      this.patchData({
        path: `/config/codespaces/${data.secretName}`,
        op: PatchOperations.add,
        value: data.encryptedValue,
      });
    };
  }

  dependabotSecret() {
    return (data: any) => {
      this.patchData({
        path: `/config/dependabot/${data.secretName}`,
        op: PatchOperations.add,
        value: data.encryptedValue,
      });
    };
  }
}
