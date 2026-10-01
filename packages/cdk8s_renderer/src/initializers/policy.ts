import { InitializerPatches } from './base';

import { helperCTX } from '../patches';

export class PolicyInitializer extends InitializerPatches {
  applicableProviders = ['terraform'];

  static applicableKinds = ['TFWorkspaceClaim'];

  async __validate() {
    return true;
  }

  async __patches(claim: any, previousCR: any) {
    return [
      {
        validate(cr: any) {
          if (
            cr.metadata.annotations &&
            cr.metadata.annotations['firestartr.dev/policy']
          ) {
            return true;
          } else {
            return false;
          }
        },

        apply(cr: any) {
          const provider = helperCTX(this).provider;

          cr.metadata['annotations'] = cr.metadata?.annotations ?? {};

          let policy = 'observe';

          if (
            previousCR &&
            previousCR.metadata.annotations['firestartr.dev/policy']
          ) {
            policy = previousCR.metadata.annotations['firestartr.dev/policy'];
          }

          policy = claim.providers[provider]?.policy ?? policy;

          cr.metadata.annotations['firestartr.dev/policy'] = policy;

          return cr;
        },

        identify() {
          return 'initializers/PolicyInitializer';
        },
      },
    ];
  }
}
