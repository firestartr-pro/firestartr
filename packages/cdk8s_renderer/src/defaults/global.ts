import { ICustomResourcePatch } from '../patches';
import { DefaultSection, DefaultSectionError } from './base';
import * as jsonPatch from 'fast-json-patch';
import fjp from 'fast-json-patch';

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
 *     globalValues: {
 *       [CR global properties, just as they appear in the actual CR]
 *     }
 *   }
 *   globalValues must be specified or the constructor will throw an error.
 * - __getDesiredPatches(): a CR and the data structure we want to patch it with.
 *
 * Output:
 * - __getDesiredPatches(): a list of fast-json-patch patches
 *
 */
export class GlobalDefault extends DefaultSection {
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

    if (data?.globalValues) {
      this.data = data.globalValues;
    } else {
      throw new DefaultSectionError('No globalValues were specified');
    }
    this.identifier = 'defaults/global';
  }

  /*
   * Given a custom resource and a data object, returns a list of relevant
   * patches from the data object to the custom resource
   *
   */
  __getDesiredPatches(cr: any, data: any) {
    const mergePatches: any[] = fjp.compare(cr.spec, data);

    // In the case of globals, we want to do only additions and replacements,
    // so we filter out all other types of operations
    return mergePatches.filter(
      (patch: any) => patch.op === 'add' || patch.op === 'replace',
    );
  }

  /*
   * Calls super.__patches() with this.data as its argument
   *
   */
  async __patches(
    _claim: any,
    _previousCR: any,
  ): Promise<ICustomResourcePatch[]> {
    return super.__patches(this.data, (a: any, b: any) =>
      fjp.compare(a, b).filter((op) => op.op === 'add' || op.op === 'replace'),
    );
  }

  /*
   * Calls super.validate() with the following JSON Schema as its argument:
   * {
   *   type: "object",
   *   properties: {
   *     [CR global properties, just as they appear in the actual CR]
   *   }
   */
  async __validate(_data: any): Promise<boolean> {
    return true;
  }
}
