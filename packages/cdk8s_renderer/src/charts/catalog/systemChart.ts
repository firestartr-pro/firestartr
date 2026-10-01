import { ISystemClaim } from '../../claims/base/system';
import { BaseCatalogChart } from './base';
import { ApiObject, GroupVersionKind } from 'cdk8s';

export class CatalogSystemChart extends BaseCatalogChart {
  template() {
    const claim: ISystemClaim = this.get('claim');

    return {
      apiVersion: 'backstage.io/v1alpha1',

      kind: 'System',

      metadata: {
        name: claim.name,

        description: claim.description,

        annotations: claim.annotations || {},
      },

      spec: {
        owner: claim.owner,

        domain: claim.domain,
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
      kind: 'System',

      apiVersion: 'v1alpha1',
    };
  }
}
