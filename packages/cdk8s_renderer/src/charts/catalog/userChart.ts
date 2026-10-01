import { IUserClaim } from '../../claims/base/user';
import { BaseCatalogChart } from './base';
import { ApiObject, GroupVersionKind } from 'cdk8s';

const ORG_ROLE_ANNOTATION = 'firestartr.backstage.dev/org-role';

export class CatalogUserChart extends BaseCatalogChart {
  template() {
    const claim: IUserClaim = this.get('claim');

    const inferredOrgRole =
      claim.providers &&
      typeof claim.providers === 'object' &&
      'github' in claim.providers &&
      (claim.providers as any).github?.role === 'admin'
        ? 'owner'
        : undefined;

    const { [ORG_ROLE_ANNOTATION]: _, ...claimAnnotations } =
      claim.annotations || {};

    const annotations: Record<string, string> = {
      ...claimAnnotations,
    };

    if (inferredOrgRole) {
      annotations[ORG_ROLE_ANNOTATION] = inferredOrgRole;
    }

    return {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'User',
      metadata: {
        name: claim.name,
        annotations,
      },

      spec: {
        profile: claim.profile,
        memberOf: claim.memberOf ?? [],
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
      kind: 'User',
      apiVersion: 'v1alpha1',
    };
  }
}
