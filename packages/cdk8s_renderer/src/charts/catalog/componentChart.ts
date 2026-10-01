import { IComponentClaim } from '../../claims/base/component';
import { BaseCatalogChart } from './base';
import { ApiObject, GroupVersionKind } from 'cdk8s';
import { sanitizeApiEntityName } from '../../utils/claimUtils';

function claimProvidesApis(claim: IComponentClaim): string[] | undefined {
  if (!claim.providesApis) return undefined;

  if (Array.isArray(claim.providesApis)) {
    return claim.providesApis.map((api) => sanitizeApiEntityName(api.name));
  }

  return Object.values(claim.providesApis).map((api) =>
    sanitizeApiEntityName(api.name),
  );
}

export class CatalogComponentChart extends BaseCatalogChart {
  template() {
    const claim: IComponentClaim = this.get('claim');
    const providesApis = claimProvidesApis(claim);

    return {
      apiVersion: 'backstage.io/v1alpha1',

      kind: 'Component',

      metadata: {
        name: claim.name,

        annotations: claim.annotations || {},
      },
      spec: {
        type: claim.type,

        lifecycle: claim.lifecycle,

        owner: claim.owner || 'nobody',

        system: claim.system,

        subComponentOf: claim.subComponentOf,
        ...(providesApis ? { providesApis } : {}),
        ...(claim.consumesApis ? { consumesApis: claim.consumesApis } : {}),
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
      kind: 'Component',

      apiVersion: 'v1alpha1',
    };
  }
}
