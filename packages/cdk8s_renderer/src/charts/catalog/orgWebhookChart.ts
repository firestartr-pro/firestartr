import { BaseCatalogChart } from './base';
import { IOrgWebhookClaim } from '../../claims/base/orgWebhook';
import { ApiObject, GroupVersionKind } from 'cdk8s';
import common from 'catalog_common';

export class CatalogOrgWebhookChart extends BaseCatalogChart {
  template() {
    const claim: IOrgWebhookClaim = this.get('claim');

    return {
      apiVersion: 'backstage.io/v1alpha1',

      kind: 'Resource',

      metadata: {
        name: common.generic.normalizeName(`orgWebhook-${claim.name}`),

        annotations: claim.annotations || {},
      },

      spec: {
        type: 'webhook',

        owner: claim.owner || 'nobody',

        system: claim.system,
      },
    };
  }

  instanceApiObject(template: any): ApiObject {
    return new ApiObject(
      this,

      `${template.kind}-${template.metadata.name}`,

      template,
    );
  }

  gvk(): GroupVersionKind {
    return {
      kind: 'Resource',

      apiVersion: 'v1alpha1',
    };
  }
}
