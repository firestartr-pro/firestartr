import { BaseCatalogChart } from './base';
import { ApiObject, GroupVersionKind } from 'cdk8s';

interface IApiCatalogClaim {
  name: string;
  type: string;
  lifecycle: string;
  owner: string;
  system: string;
  definitionUrl: string;
  annotations?: Record<string, string>;
}

export class CatalogApiChart extends BaseCatalogChart {
  template() {
    const claim: IApiCatalogClaim = this.get('claim');

    return {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'API',
      metadata: {
        name: claim.name,
        annotations: claim.annotations || {},
      },
      spec: {
        type: claim.type,
        lifecycle: claim.lifecycle,
        owner: claim.owner || 'nobody',
        system: claim.system,
        definition: {
          $text: claim.definitionUrl,
        },
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
      kind: 'API',
      apiVersion: 'v1alpha1',
    };
  }
}
