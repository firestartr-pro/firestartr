import * as jsonPatch from 'fast-json-patch';
import fjp from 'fast-json-patch';
import * as _ from 'lodash';
import lodash from 'lodash';
import { mergeTwoArrays } from '../../src/utils/crUtils';
import { ICustomResourcePatch } from '../patches';
import Ajv from 'ajv/dist/2020';
import { BasePatches } from '../patches/base';

/*
 * Base class of our default global and initializer objects.
 * Child classes should receive arbitrary CR data to create a patch
 * object (CustomResourcePatch) that will be able to:
 * - Apply a patch to a CR in the form of JSON patches
 * - Verify that the patches have been correctly applied
 * They will also be able to validate the data they received with validate()
 *
 * Input:
 * - __patches(): a claim (which the function does nothing with) and
 *   the data to patch the CR with.
 * - validate(): a JSON Schema object that validates the data recieved
 *   by the constructor.
 *
 * Output:
 * - __patches(): a ICustomResourcePatch[].
 * - validate(): a boolean, whether the data follows the
 *   specified JSON Schema or not.
 */
export abstract class DefaultSection extends BasePatches {
  protected data: any = {};
  protected identifier = 'defaults/base';
  protected claimKind?: string;

  arrayPaths: any = {};

  abstract __getDesiredPatches(cr: any, data: any): any[];

  /*
   * Receives a JSON Schema object and validates the chosen data
   * object against it. Returns whether the object is valid or not.
   *
   */
  async validate(schema: any) {
    const ajv = new Ajv({
      allErrors: true,
    });

    const ajvValidate = ajv.compile(schema);

    return ajvValidate(this.data);
  }

  /*
   * Receives the data we want to patch with and returns a
   * ICustomResourcePatch object list.
   * Each ICustomResourcePatch contains the following functions:
   * - apply: Receives a custom resource and applies patchData as
   *   a JSON patch to it
   * - validate: Receives a custom resource and validates that patchData
   *   has been correctly applied to it
   * - identify: returns the class' identifier
   */
  async __patches(
    patchData: any,
    mergeFilterFn: Function,
  ): Promise<ICustomResourcePatch[]> {
    // Values are stored in a const beforehand because the
    // enclosed functions don't have access to this
    const getPatchesFn: Function = this.__getDesiredPatches;
    const identifier: string = this.identifier;
    const arrayPaths: any = this.arrayPaths;
    const __self: DefaultSection = this;

    return [
      {
        async apply(cr: any) {
          // Merge object arrays
          const mergeResult: any = await __self._mergeObjectArrays(
            cr,
            patchData,
            mergeFilterFn,
            arrayPaths,
          );

          cr = mergeResult.cr;

          patchData = mergeResult.patchData;

          // Get the patch list
          const patchList: any[] = getPatchesFn(cr, patchData);

          // We apply the patches, update the cr.spec field and return the CR
          cr.spec = fjp.applyPatch(cr.spec, patchList).newDocument;

          return cr;
        },

        async validate(cr: any) {
          // Merge object arrays
          const mergeResult: any = await __self._mergeObjectArrays(
            cr,
            patchData,
            mergeFilterFn,
            arrayPaths,
          );

          cr = mergeResult.cr;

          patchData = mergeResult.patchData;

          // Get the patch list
          const patchList: any[] = getPatchesFn(cr, patchData);

          // If the patchList array has length greater than 0,
          // that must mean some operation was either overriden or not
          // done at all. That would make our CR invalid
          return patchList.length === 0;
        },

        identify() {
          return identifier;
        },
      },
    ];
  }

  async _mergeObjectArrays(
    cr: any,
    patchData: any,
    mergeFilterFn: Function,
    arrayPaths: any,
  ) {
    // Clone the CR and patch data so that we don't accidentally override them
    cr = fjp.deepClone(cr);

    patchData = fjp.deepClone(patchData);

    const prevJsonPatches: any[] = fjp.compare(cr.spec, patchData);

    const listsToMerge: any = {};

    // Check if any patches modify an array, using the operation path
    for (const op of prevJsonPatches) {
      for (const key in arrayPaths) {
        if (arrayPaths[key].fTest(cr, op.path)) {
          listsToMerge[key] = arrayPaths[key];
        }
      }
    }

    // Done like this to prevent "Object is of type unknown" errors
    let listMergeTask: any;
    for (listMergeTask of Object.values(listsToMerge)) {
      // Merge the CR array and the patch data array together
      const result: any = mergeTwoArrays(
        lodash.get(cr.spec, listMergeTask.replace, []),
        lodash.get(patchData, listMergeTask.replace, []),
        listMergeTask.keys,
        mergeFilterFn,
      );

      // Then assign the result to themselves so the next
      // jsonPatch.compare() sees them as equal
      lodash.set(cr.spec, listMergeTask.replace, result);
      lodash.set(patchData, listMergeTask.replace, result);
    }

    return { cr, patchData };
  }
}

/*
 * Error class for the previous one. No special functionality,
 * created just to signal that when an error happens, it
 * happened somewhere within this process
 *
 */
export class DefaultSectionError extends Error {
  constructor(message: string) {
    super(message);

    /*
     * Without this piece of code, this:
     *
     *   if(typeof error == DefaultSectionError) { ... }
     *
     * doesn't work
     *
     */
    Object.setPrototypeOf(this, DefaultSectionError.prototype);
  }
}
