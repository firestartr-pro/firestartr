import _ from 'lodash';
import fjp from 'fast-json-patch';

import log from '../logger';

/*
 * Default blocks are objects that cannot be merged but applied as a whole. Meaning:
 * - If the object is defined at the claim-level it is maintained *AS IT IS* (no merge)
 * - If the block is missing at the claim-level, the default block is applied
 */
const defaultBlocksPaths = ['/providers/terraform/sync'];

export function applyBlockAwareDefaults(claim: any, defaultClaim: any) {
  // we always work with a clone of the original
  const claimClone = JSON.parse(JSON.stringify(claim));

  // if the block is claim-level defined we store it here
  const defaultBlocks: Map<string, any> = new Map();

  // we remove the blocks entirely of the claim
  // to achieve an add copy
  for (const defaultBlockPath of defaultBlocksPaths) {
    if (hasDeepPath(claimClone, defaultBlockPath) !== true) continue;

    const originalValue = fjp.getValueByPointer(claimClone, defaultBlockPath);

    if (originalValue) {
      log.silly(
        `${claim.kind}/${claim.name}: has an original ${defaultBlockPath}: preserving`,
      );

      defaultBlocks.set(defaultBlockPath, originalValue);

      fjp.applyPatch(
        claimClone,

        [{ op: 'remove', path: defaultBlockPath }],
      );
    }
  }

  // if the patch has the same path of a block
  // and the block was defined at claim-level
  // we interchange the value with the original value
  // otherwise we use the default
  const jsonPatchOps = fjp
    .compare(claimClone, defaultClaim)
    .filter((jp: any) => jp.op === 'add')
    .map((jp: any) => {
      if (defaultBlocks.has(jp.path)) {
        return {
          ...jp,
          value: defaultBlocks.get(jp.path),
        };
      } else {
        return jp;
      }
    });

  return fjp.applyPatch(claimClone, jsonPatchOps).newDocument;
}

function hasDeepPath(data: any, deepPath: string): boolean {
  return _.has(data, deepPath.replace(/\//g, '.').replace(/^\./, ''));
}
