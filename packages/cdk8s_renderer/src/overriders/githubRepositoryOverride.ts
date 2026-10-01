import {
  Permission,
  CollaboratorPermission,
  createCodeOwnersData,
  createPermissionsListFor,
} from '../utils/repositoryClaimUtils';
import { ICustomResourcePatch, OverriderPatches } from './base';
import * as fastJsonPatch from 'fast-json-patch';
import fjp from 'fast-json-patch';
import * as _ from 'lodash';
import lodash from 'lodash';

export class GithubRepositoryOverrider extends OverriderPatches {
  applicableProviders = ['github'];

  async __validate(): Promise<boolean> {
    return true;
  }

  async __patches(
    claim: any,
    previousCR: any,
    crs?: any,
  ): Promise<ICustomResourcePatch[]> {
    const specOverrides = await super.__patches(claim, previousCR, crs);

    const additionalPermissions = this.additionalPermissions(
      claim,
      previousCR,
      crs,
    );

    const additionalCodeownersRules = this.additionalCodeownersRules(
      claim,
      previousCR,
      crs,
    );

    return additionalPermissions
      .concat(additionalCodeownersRules)
      .concat(specOverrides);
  }

  private additionalPermissions(
    claim: any,
    _previousCR: any,
    crs?: any,
  ): ICustomResourcePatch[] {
    let permissions: (Permission | CollaboratorPermission)[] = [];

    return [
      {
        validate(_cr: any) {
          return true;
        },

        apply(cr: any) {
          if (claim.maintainedBy) {
            const maintainedByList = createPermissionsListFor(
              claim.maintainedBy,
              'maintain',
              crs,
            );

            permissions = permissions.concat(maintainedByList);
          }

          if (claim?.providers?.github?.overrides?.additionalAdmins) {
            const additionalAdmins = createPermissionsListFor(
              claim.providers.github.overrides.additionalAdmins,
              'admin',
              crs,
            );

            permissions = permissions.concat(additionalAdmins);
          }

          if (claim?.providers?.github?.overrides?.additionalMaintainers) {
            const additionMaintainers = createPermissionsListFor(
              claim.providers.github.overrides.additionalMaintainers,
              'maintain',
              crs,
            );

            permissions = permissions.concat(additionMaintainers);
          }

          if (claim?.providers?.github?.overrides?.additionalWriters) {
            const additionalWriters = createPermissionsListFor(
              claim.providers.github.overrides.additionalWriters,
              'push',
              crs,
            );

            permissions = permissions.concat(additionalWriters);
          }

          if (claim?.providers?.github?.overrides?.additionalReaders) {
            const additionalWriters = createPermissionsListFor(
              claim.providers.github.overrides.additionalReaders,
              'pull',
              crs,
            );

            permissions = permissions.concat(additionalWriters);
          }

          for (const permission of permissions) {
            const isNewPermission: boolean =
              cr.spec.permissions.filter((e: any) =>
                lodash.isEqual(e, permission),
              ).length === 0;

            if (isNewPermission) {
              const patch: any[] = [
                {
                  op: 'add',
                  path: '/spec/permissions/-',
                  value: permission,
                },
              ];

              cr = fjp.applyPatch(cr, patch).newDocument;
            }
          }

          return cr;
        },

        identify() {
          return 'overriders/GithubRepositoryOverrider/additionalPermissions';
        },
      },
    ];
  }

  private additionalCodeownersRules(
    claim: any,
    _previousCR: any,
    crs?: any,
  ): ICustomResourcePatch[] {
    return [
      {
        validate(_cr: any) {
          return true;
        },

        apply(cr: any) {
          const patch: any[] = [];

          if (claim?.providers?.github?.overrides?.additionalCodeownersRules) {
            const codeowners = createCodeOwnersData(
              claim,
              claim.providers.github.overrides.additionalCodeownersRules,
              crs,
            );

            patch.push({
              op: 'replace',

              path: '/spec/repo/codeowners',

              value: codeowners,
            });
          }

          return fjp.applyPatch(cr, patch).newDocument;
        },

        identify() {
          return 'overriders/GithubRepositoryOverrider/additionalCodeownersRules';
        },
      },
    ];
  }
}
