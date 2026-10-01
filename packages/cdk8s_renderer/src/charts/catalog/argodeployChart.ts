import { IArgoDeployClaim } from '../../claims/base/deploy';

import { BaseCatalogChart } from './base';

import { ApiObject, GroupVersionKind } from 'cdk8s';

export class CatalogArgoDeployChart extends BaseCatalogChart {
  template() {
    const claim: IArgoDeployClaim = this.get('claim');

    return {
      apiVersion: 'backstage.io/v1alpha1',

      kind: 'Resource',

      metadata: {
        name: claim.name,

        description: claim.description,

        annotations: claim.annotations || {},
      },

      spec: {
        type: claim.type || 'argodeploy',
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
