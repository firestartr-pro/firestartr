import { BaseCatalogChart } from './base';
import { ApiObject, GroupVersionKind } from 'cdk8s';
import common from 'catalog_common';

export class CatalogSecretsChart extends BaseCatalogChart {
  template() {
    const claim: any = this.get('claim');

    return {
      apiVersion: 'backstage.io/v1alpha1',

      kind: 'Resource',

      metadata: {
        name: common.generic.normalizeName(`secrets-${claim.name}`),

        title: claim.name,

        annotations: claim.annotations || {},
      },

      spec: {
        type: 'secret-set',

        owner: claim.owner,

        system: claim.system,

        secrets: claim.providers,

        dependsOn: [],
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
