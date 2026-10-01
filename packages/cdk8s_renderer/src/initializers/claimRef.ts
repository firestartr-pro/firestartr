import { InitializerPatches } from './base';
import common from 'catalog_common';
export class InitializerClaimRef extends InitializerPatches {
  protected static applicableKinds: string[] = [
    'GroupClaim',
    'UserClaim',
    'ComponentClaim',
    'TFWorkspaceClaim',
    'OrgWebhookClaim',
    'OrgSettingsClaim',
  ];

  applicableProviders = ['github', 'terraform'];

  async __validate() {
    return true;
  }

  async __patches(claim: any, _previousCR: any) {
    return [
      {
        validate(cr: any) {
          return cr;
        },

        apply(cr: any) {
          cr.metadata = cr.metadata ?? {};

          cr.metadata.labels = cr.metadata.labels ?? {};

          const claimName = claim._parentClaimName || claim.name;

          cr.metadata.labels['claim-ref'] =
            common.generic.normalizeLabel(claimName);

          cr.metadata.annotations = {
            ...(cr.metadata.annotations || {}),

            [common.generic.getFirestartrAnnotation('claim-ref')]:
              `${claim.kind}/${claimName}`,
          };

          return cr;
        },

        identify() {
          return 'initializers/InitializerClaimRef';
        },
      },
    ];
  }
}
