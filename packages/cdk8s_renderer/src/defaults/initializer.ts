import { ICustomResourcePatch } from '../patches';
import { DefaultSection, DefaultSectionError } from './base';
import * as jsonPatch from 'fast-json-patch';
import fjp from 'fast-json-patch';

import { applyOneWayDefs } from './oneWayDefs';

/*
 * This class extends DefaultSection and recieves arbitrary CR data to
 * create a patch object (CustomResourceDefaultsPatch) capable of:
 * - Applying it to a CR in the form of JSON patches
 * - Verifying that the patches have been correctly applied
 * It also can verify the data it has is valid using JSON Schema.
 *
 * Input:
 * - constructor(): a data object. It must have the following format:
 *   {
 *     ...metadata,
 *     defaultValues: {
 *       [CR initializer properties, just as they appear in the actual CR]
 *     }
 *   }
 *   defaultValues must be specified or the constructor will throw an error.
 * - __getDesiredPatches(): a CR and the data structure we want to patch it with.
 *
 * Output:
 * - __getDesiredPatches(): a list of fast-json-patch patches
 *
 */
export class InitializerDefault extends DefaultSection {
  applicableProviders = ['github'];

  arrayPaths: any = {
    permissions: {
      fTest: (_cr: any, path: string) => {
        return (
          ['ComponentClaim', 'FirestartrGithubRepository'].includes(
            this.claimKind as string,
          ) && path.includes('/permissions')
        );
      },

      replace: 'permissions',

      keys: ['ref.kind', 'ref.name'],
    },
  };

  constructor(data: any) {
    super();

    this.claimKind = this.claimKind ? this.claimKind : data.kind;

    if (data?.defaultValues) {
      this.data = data.defaultValues;
    } else {
      throw new DefaultSectionError('No defaultValues were specified');
    }

    this.identifier = 'defaults/initializer';
  }

  /*
   * Given a custom resource and a data object, returns a list of relevant
   * patches from the data object to the custom resource
   *
   */
  __getDesiredPatches(cr: any, data: any) {
    const mergePatches: any[] = fjp.compare(cr.spec, data);

    // In the case of initializers, we want to do only additions,
    // so we filter out all other types of operations
    return mergePatches.filter((patch: any) => {
      return patch.op === 'add';
    });
  }

  async __validate(_data: any): Promise<boolean> {
    return true;
  }

  /*
   * If previousCR.spec has a value, calls super.__patches() with it as its
   * argument after including all fields missing in it but present in this.data.
   * Otherwise calls super.__patches() with this.data as the argument
   *
   */
  async __patches(
    _claim: any,
    previousCR: any,
  ): Promise<ICustomResourcePatch[]> {
    let patchData: any = {};

    if (previousCR?.spec) {
      // This code add fields present in this.data but missing in
      // previousCR.spec into the later

      const previousCRCurated = applyOneWayDefs(previousCR);

      const fieldsToAddPatches: any[] = fjp
        .compare(previousCRCurated.spec, this.data)
        .filter((op) => op.op === 'add');

      patchData = fjp.applyPatch(
        previousCRCurated.spec,
        fieldsToAddPatches,
      ).newDocument;
    } else {
      patchData = this.data;
    }

    return super.__patches(patchData, (a: any, b: any) =>
      fjp.compare(a, b).filter((op) => op.op === 'add'),
    );
  }
}
