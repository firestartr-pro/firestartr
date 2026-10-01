import {
  FirestartrGithubOrgWebhook,
  FirestartrGithubOrgWebhookProps,
  FirestartrGithubOrgWebhookSpecWebhookSecretRef,
  FirestartrGithubOrgWebhookSpecWebhookSecretRefKind,
} from '../../../imports/firestartr.dev';
import { IUnitializedStateKey } from '../../claims/base';
import { IGithubOrgWebhookClaim } from '../../claims/github/orgWebhook';
import { BaseGithubChart } from './base';

export class GithubOrgWebhookChart extends BaseGithubChart {
  public template(): FirestartrGithubOrgWebhookProps | IUnitializedStateKey {
    const claim: IGithubOrgWebhookClaim = this.get('claim');
    const firestartrId: string = this.get('firestartrId');

    return {
      metadata: {
        name: claim.providers.github.name,
      },

      spec: {
        orgName: claim.providers.github.orgName,
        firestartr: {
          tfStateKey: firestartrId,
        },
        webhook: {
          url: claim.providers.github.webhook.url,
          contentType: claim.providers.github.webhook.contentType,
          secretRef: this.renderSecret(
            claim.providers.github.webhook.secretRef,
          ),
          active: claim.providers.github.webhook.active,
          events: claim.providers.github.webhook.events,
        },

        writeConnectionSecretToRef: {
          name: `firestartrgithuborgwebhook-${claim.providers.github.name}-outputs`.toLowerCase(),
          outputs: [],
        },
      },
    };
  }

  renderSecret(secret: string): FirestartrGithubOrgWebhookSpecWebhookSecretRef {
    const parts = secret.split(':');

    if (parts.length < 4) {
      throw `GithubOrgWebhookChart: invalid secretRef: ${secret}. Expected format: <provider>:<namespace>:<name>:<key>`;
    }

    return {
      kind: 'Secret' as FirestartrGithubOrgWebhookSpecWebhookSecretRefKind,

      name: parts[2],

      key: parts[3],
    };
  }

  gvk() {
    return FirestartrGithubOrgWebhook.GVK;
  }

  instanceApiObject(template: any): FirestartrGithubOrgWebhook {
    return new FirestartrGithubOrgWebhook(
      this,
      template.metadata.name,
      template,
    );
  }
}
