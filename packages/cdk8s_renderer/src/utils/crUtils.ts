import * as jsonPatch from 'fast-json-patch';
import fjp from 'fast-json-patch';
import * as _ from 'lodash';
import lodash from 'lodash';

/*
 * Function that receives a base array baseArray and merges it with
 * arrayToMerge, preserving the order.
 *
 * input:
 *   - baseArray: the array to be updated
 *   - arrayToMerge: the array the updates will be based on
 *   - mapKeys: list of object value names which, when combined together,
 *     uniquely identify each object of the array
 *   - filterFn: function that receives two objects, calls json.compare() on
 *     them and removes unwanted patches. Used once the arrays are mapped
 *     to an object
 *
 * output: the merged array
 *
 */
export function mergeTwoArrays(
  baseArray: any[],
  arrayToMerge: any[],
  mapKeys: string[],
  filterFn: Function,
): any[] {
  let i = 0;
  const baseArrayAsObject: any = {};
  const arrayToMergeAsObject: any = {};

  // This function creates a unique identifier for each array object using
  // the value of each key in mapKeys (for example, if mapKeys is
  // ["kind", "name"] it will return an ID like
  // "FirestartrGithubRepository_test-repo-a")
  const indexer = (element: any) =>
    mapKeys.map((k) => lodash.get(element, k)).join('_');

  for (const el of baseArray) {
    if (!(indexer(el) in baseArrayAsObject))
      // In this case we want to preserve the order of this array,
      // so we store its index as well
      baseArrayAsObject[indexer(el)] = { ...el, $i: i++ };
  }

  for (const el of arrayToMerge) {
    arrayToMergeAsObject[indexer(el)] = el;
  }

  // We get the patch using filterFn and apply it
  const patch: any[] = filterFn(baseArrayAsObject, arrayToMergeAsObject);
  const resultingArrayAsObject: any = fjp.applyPatch(
    baseArrayAsObject,
    patch,
  ).newDocument;

  // We then recreate the array, minding the order. Existing elements have
  // their order preserved, while new elements are added to the end
  // of the array
  const resultingArray: any[] = [];
  Object.values(resultingArrayAsObject)
    .filter((el: any) => '$i' in el)
    .forEach((v: any) => (resultingArray[v['$i']] = v));
  Object.values(resultingArrayAsObject)
    .filter((el: any) => !('$i' in el))
    .forEach((v: any) => resultingArray.push(v));

  // We remove the property $i before returning the array as it's no longer needed
  return resultingArray.map((el: any) => {
    delete el['$i'];
    return el;
  });
}

/*
 * Dictionary which contains, for each CR kind, the fields which are known
 * to have references to other CRs
 *
 */
const WELL_KNOWN_RELATIONS: any = {
  FirestartrGithubGroup: ['spec.members'],
  FirestartrGithubRepository: ['spec.permissions'],
};

/*
 * Function that receives a CR and sets its known relations (i.e., fields that
 * are known to contain references to other CRs) to undefined
 *
 * input: the CR whose relations we want to strip
 * output: that same CR with its known relations stripped
 *
 */
export function stripKnownRelations(cr: any) {
  for (const rel of WELL_KNOWN_RELATIONS[cr.kind] || []) {
    lodash.set(cr, rel, undefined);
  }
  return cr;
}
