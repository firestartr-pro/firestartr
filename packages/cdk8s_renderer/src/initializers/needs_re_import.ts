import { InitializerPatches } from './base';
import common from 'catalog_common';
import { ICustomResourcePatch } from '../patches';

export class NeedsReImportInitializer extends InitializerPatches {
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
    const needsReImportAnnotation: string =
      common.generic.getFirestartrAnnotation('needs-re-import');

    return [
      {
        validate(cr: any) {
          return cr?.metadata?.annotations[needsReImportAnnotation]
            ? true
            : false;
        },

        apply(cr: any) {
          cr.metadata['annotations'] = cr.metadata?.annotations ?? {};

          cr.metadata.annotations[needsReImportAnnotation] =
            cr.metadata.annotations[needsReImportAnnotation] ?? 'true';

          return cr;
        },

        identify() {
          return 'initializers/NeedsReImport';
        },
      },
    ];
  }
}
