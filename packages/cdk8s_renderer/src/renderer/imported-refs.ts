// takes a cr and walks to find
// any '<type>-imported-ref' being type: user|group

import log from '../logger';

import common from 'catalog_common';

import { RenderClaimData } from './types';

// ref must match type-imported-ref where type can be group|user and:<value>
// example: user-imported-ref:My Group
const REGEX_IMPORTED_REF = /^(?<type>user|group)-imported-ref:(?<value>.+)$/;

type SymbolResolver = (
  solver: (type: string, value: string) => Promise<string>,
) => Promise<void>;

export function importedsRefsWalker(
  renderClaim: RenderClaimData,
): SymbolResolver[] {
  // cr is an object, we want to walk through all its properties recursively
  // the property can be another object, an array, or a primitive value

  // has a function to resolve
  // has to be an array of functions with
  // the following signature: (solver: (type: string, value: string) => Promise<string>) => Promise<void>

  const symbolsToResolve: SymbolResolver[] = [];

  walk(renderClaim.claim, symbolsToResolve, renderClaim);

  return symbolsToResolve;
}

function walk(
  element: any,
  symbolsToResolve: SymbolResolver[],
  renderClaim: RenderClaimData,
): any {
  if (typeof element === 'string' || typeof element === 'number') {
    return element;
  } else if (Array.isArray(element)) {
    return walkArray(element, symbolsToResolve, renderClaim);
  } else if (typeof element === 'object' && element !== null) {
    return walkObject(element, symbolsToResolve, renderClaim);
  } else {
    return element;
  }
}

function walkObject(
  obj: any,
  symbolsToResolve: SymbolResolver[],
  renderClaim: RenderClaimData,
) {
  for (const key in obj) {
    const value = obj[key];
    if (typeof value === 'string') {
      const match = value.match(REGEX_IMPORTED_REF);
      if (!match) {
        continue;
      }

      const type = match.groups?.type;

      const capturedKey = key;

      if (type) {
        log.info(
          `Found an imported-ref in the claim with key ${key} and value ${value}. This will be resolved later.`,
        );

        symbolsToResolve.push(
          async (solver: (type: string, value: string) => Promise<string>) => {
            const resolvedValue = await solver(type, match.groups?.value ?? '');

            log.info(
              `Resolved imported-ref with key ${key} and value ${value} to ${resolvedValue} in path ${renderClaim.claimPath}`,
            );

            obj[capturedKey] = resolvedValue;

            if (!renderClaim.claimPath) {
              throw new Error(
                `claimPath is required to write the claim after resolving imported refs in ${capturedKey}`,
              );
            }

            await common.io.writeClaim(
              renderClaim.claim,
              renderClaim.claimPath,
            );
          },
        );
      }
    } else {
      walk(value, symbolsToResolve, renderClaim);
    }
  }
}

function walkArray(
  arr: any[],
  symbolsToResolve: SymbolResolver[],
  renderClaim: RenderClaimData,
) {
  for (let i = 0; i < arr.length; i++) {
    const value = arr[i];
    if (typeof value === 'string') {
      const match = value.match(REGEX_IMPORTED_REF);
      if (!match) {
        continue;
      }

      log.info(
        `Found an imported-ref in the claim with value ${value}. This will be resolved later.`,
      );

      const type = match.groups?.type;

      if (type) {
        const capturedIndex = i;

        symbolsToResolve.push(
          async (solver: (type: string, value: string) => Promise<string>) => {
            const resolvedValue = await solver(type, match.groups?.value ?? '');

            log.info(
              `Resolved imported-ref with value ${value} to ${resolvedValue} in path ${renderClaim.claimPath}`,
            );

            arr[capturedIndex] = resolvedValue;

            if (!renderClaim.claimPath) {
              throw new Error(
                `claimPath is required to write the claim after resolving imported refs in ${capturedIndex}`,
              );
            }

            await common.io.writeClaim(
              renderClaim.claim,
              renderClaim.claimPath,
            );
          },
        );
      }
    } else {
      walk(value, symbolsToResolve, renderClaim);
    }
  }
}
