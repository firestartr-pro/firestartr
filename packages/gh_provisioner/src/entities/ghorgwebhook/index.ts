import { Entity, PatchOperations } from '../base';

import github from 'github';

import log from '../../logger';

export class EntityGHOrgWebHook extends Entity {
  constructor(artifact: any) {
    super(artifact, {
      config: {},
    });
  }

  async loadResources(tfOp: string): Promise<void> {
    log.info(`[gh-provisioner] running ${tfOp} on ${this.k8sId}`);

    try {
      const cr = this.cr;

      const secretRef = Entity.refResolver({
        kind: 'Secret',
        ...cr.spec.webhook.secretRef,
      });

      this.patchData({
        path: '/config/webhook',

        op: PatchOperations.add,

        value: {
          active: cr.spec.webhook.active ?? true,
          events: cr.spec.webhook.events,
          configuration: {
            url: cr.spec.webhook.url,
            contentType: cr.spec.webhook.contentType,
            secret: secretRef.getOutput(cr.spec.webhook.secretRef.key),
            insecureSsl: cr.spec.webhook.insecureSsl ?? false,
          },
        },
      });

      log.debug(`[gh-provisioner] ${this.k8sId} loaded its data`);
    } catch (err) {
      log.error(
        `[gh-provisioner] ${this.k8sId} error loading resources: ${err}`,
      );

      throw `[gh-provisioner] ${this.k8sId} error loading resources: ${err}`;
    }
  }

  async postProvision(tfOp: string): Promise<void> {}

  async getWebhookInfo(): Promise<any> {
    log.info(`[gh-provisioner] getting webhook info for ${this.k8sId}`);

    const webhookInfo = await this.runWithGithubProvider(async () => {
      return (await github.org.getWebhookList(this.cr.spec.orgName)).find(
        (webhook: any) => {
          return webhook.config.url === this.cr.spec.webhook.url;
        },
      );
    });

    return webhookInfo;
  }

  async loadAddressesToImport(): Promise<void> {
    log.info(`[gh-provisioner] loading addresses to import for ${this.k8sId}`);

    const webhookInfo = await this.getWebhookInfo();

    this.patchImportData({
      op: PatchOperations.add,

      path: '/imports/-',

      value: {
        to: 'github_organization_webhook.this',
        id: `${webhookInfo.id}`,
      },
    });
  }
}
