import * as fastJsonPatch from 'fast-json-patch';
import { BasePatches } from '../patches/base';

export abstract class OverriderPatches extends BasePatches {
  abstract __validate(): Promise<boolean>;

  async __patches(
    claim: any,
    _previousCR: any,
    _crs?: any,
  ): Promise<ICustomResourcePatch[]> {
    return [
      {
        validate(_cr: any) {
          return true;
        },

        apply(cr: any) {
          if (
            !claim.providers.github.overrides ||
            !claim.providers.github.overrides.spec
          ) {
            return cr;
          }

          const jsonPatchOperations = fastJsonPatch
            .compare(cr.spec, claim.providers.github.overrides.spec)
            .filter((jp: any) => {
              return jp.op !== 'remove';
            });

          cr.spec = fastJsonPatch.applyPatch(
            cr.spec,
            jsonPatchOperations,
          ).newDocument;

          return cr;
        },

        identify() {
          return 'overriders/Overrider/specOverrides';
        },
      },
    ];
  }

  async validate() {
    return await this.__validate();
  }
}

export class OverriderError extends Error {
  constructor(message: string) {
    super(message);

    Object.setPrototypeOf(this, OverriderError.prototype);
  }
}

export interface ICustomResourcePatch {
  validate: Function;

  apply: Function;

  identify: Function;
}
