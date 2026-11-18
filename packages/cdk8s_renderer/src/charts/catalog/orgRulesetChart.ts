import { BaseCatalogChart } from './base';
import { IOrgRulesetClaim } from '../../claims/base/orgRuleset';
import { ApiObject, GroupVersionKind } from 'cdk8s';
import common from 'catalog_common';

export class CatalogOrgRulesetChart extends BaseCatalogChart {
  template() {
    const claim: IOrgRulesetClaim = this.get('claim');

    return {
      apiVersion: 'backstage.io/v1alpha1',

      kind: 'Resource',

      metadata: {
        name: common.generic.normalizeName(`orgRuleset-${claim.name}`),

        annotations: claim.annotations || {},
      },

      spec: {
        type: 'ruleset',

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
