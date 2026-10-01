import { InitializerPatches } from './base';
import common from 'catalog_common';
import { ICustomResourcePatch } from '../patches';

export class ImportInitializer extends InitializerPatches {
  protected static applicableKinds: string[] = [
    'GroupClaim',
    'UserClaim',
    'ComponentClaim',
  ];

  applicableProviders = ['github'];

  async __validate() {
    return true;
  }

  async __patches(
    _claim: any,
    _previousCR: any,
  ): Promise<ICustomResourcePatch[]> {
    const importAnnotation: string =
      common.generic.getFirestartrAnnotation('import');

    return [
      {
        validate(cr: any) {
          return cr?.metadata?.annotations[importAnnotation] ? true : false;
        },

        apply(cr: any) {
          cr.metadata['annotations'] = cr.metadata?.annotations ?? {};

          cr.metadata.annotations[importAnnotation] =
            cr.metadata.annotations[importAnnotation] ?? 'true';

          return cr;
        },

        identify() {
          return 'initializers/Import';
        },
      },
    ];
  }
}
