import { IGroupClaim } from '../../claims';
import { BaseCatalogChart } from './base';
import { ApiObject, GroupVersionKind } from 'cdk8s';

export class CatalogGroupChart extends BaseCatalogChart {
  template() {
    const claim: IGroupClaim = this.get('claim');

    return {
      apiVersion: 'backstage.io/v1alpha1',

      kind: 'Group',

      metadata: {
        name: claim.name,

        description: claim.description,

        annotations: claim.annotations || {},
      },

      spec: {
        type: claim.type,

        profile: claim.profile,

        parent: claim.parent,

        children: claim.children ?? [],

        members: claim.members ?? [],
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
      kind: 'Group',
      apiVersion: 'v1alpha1',
    };
  }
}
