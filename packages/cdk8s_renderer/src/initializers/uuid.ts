import { v4 as uuidv4 } from 'uuid';
import { InitializerError, InitializerPatches } from './base';
import { helperCTX } from '../patches';

export class UUIDInitializer extends InitializerPatches {
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

  async __patches(claim: any, previousCR: any) {
    if (UUIDInitializer.applicableKinds.indexOf(claim.kind) === -1) {
      throw new InitializerError(
        `${claim.name} is of kind ${claim.kind}, which is not allowed. ` +
          `Allowed kinds: ${UUIDInitializer.applicableKinds}`,
      );
    }

    const uuid: any = false;

    const fBuildWriteConnectionSecretToRef = (
      cr: any,

      crKind: string,
    ) => {
      return `${crKind}-${cr.metadata.name}-outputs`.toLowerCase();
    };

    return [
      {
        validate(cr: any) {
          return cr.spec.firestartr.tfStateKey === uuid;
        },

        apply(cr: any) {
          const ctx = helperCTX(this);

          const reusePrevious = previousCR && previousCR.kind === ctx.kind;

          const uuid = reusePrevious
            ? previousCR?.spec?.firestartr?.tfStateKey ||
              claim.providers?.[ctx.provider]?.tfStateKey ||
              uuidv4()
            : cr.spec?.firestartr?.tfStateKey ||
              claim.providers?.[ctx.provider]?.tfStateKey ||
              uuidv4();

          if (!cr.spec) cr.spec = {};

          if (!cr.spec.firestartr) cr.spec.firestartr = {};

          cr.spec.firestartr.tfStateKey = uuid;

          cr.metadata.name = cr.metadata.name.includes(uuid)
            ? cr.metadata.name
            : `${cr.metadata.name}-${uuid}`;

          if (cr.spec.writeConnectionSecretToRef) {
            cr.spec.writeConnectionSecretToRef.name =
              fBuildWriteConnectionSecretToRef(cr, ctx.kind);
          }
          return cr;
        },

        identify() {
          return 'initializers/UUIDInitializer';
        },
      },
    ];
  }
}
