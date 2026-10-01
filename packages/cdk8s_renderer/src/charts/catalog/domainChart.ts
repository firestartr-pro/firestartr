import { IDomainClaim } from '../../claims/base/domain';
import { BaseCatalogChart } from './base';
import { ApiObject, GroupVersionKind } from 'cdk8s';

export class CatalogDomainChart extends BaseCatalogChart {
  template() {
    const claim: IDomainClaim = this.get('claim');

    return {
      apiVersion: 'backstage.io/v1alpha1',

      kind: 'Domain',

      metadata: {
        name: claim.name,

        description: claim.description,

        annotations: claim.annotations || {},
      },

      spec: {
        owner: claim.owner,
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
      kind: 'Domain',

      apiVersion: 'v1alpha1',
    };
  }
}
