// this function ensures that there are some specs that have to be defined
// anew and cannot be fed back from the previous CR
//
// The only definition is the one in the claim-level and the resulting rendered CR
// Thus it performs a nullify of the designed patches

import fjp from 'fast-json-patch';
import _ from 'lodash';

const ONE_WAY_DEFINITIONS = [
  '/spec/vars',
  '/spec/actions/oidc',
  '/spec/repo/labels',
  '/spec/actionsVariables',
];

export function applyOneWayDefs(crSpecs: any) {
  const crSpecsClone = JSON.parse(JSON.stringify(crSpecs));

  for (const defPath of ONE_WAY_DEFINITIONS) {
    if (hasDeepPath(crSpecs, defPath)) {
      fjp.applyPatch(
        crSpecsClone,

        [{ op: 'remove', path: defPath }],
      );
    }
  }

  return crSpecsClone;
}

function hasDeepPath(data: any, deepPath: string): boolean {
  return _.has(data, deepPath.replace(/\//g, '.').replace(/^\./, ''));
}
