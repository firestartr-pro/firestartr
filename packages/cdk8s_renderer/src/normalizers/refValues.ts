import { ICustomResourcePatch, helperCTX } from '../patches';
import { resolveClaimRef } from '../refresolver';
import { Normalizer } from './base';
import common from 'catalog_common';

import {
  isRepoSecretRef,
  extractRepoSecretRef,
} from '../utils/repositoryClaimUtils';

import * as _ from 'lodash';

export class RefValuesNormalizer extends Normalizer {
  applicableProviders = ['terraform'];

  async __validate(_schema: any): Promise<boolean> {
    return true;
  }

  rsClaimRef: Function = resolveClaimRef;

  async __patches(
    claim: any,
    _previousCR: any,
  ): Promise<ICustomResourcePatch[]> {
    const resolver = this.rsClaimRef;

    return [
      {
        validate(_cr: any) {
          return true;
        },

        async apply(cr: any) {
          const provider: string = helperCTX(this).provider;

          const values = claim.providers[provider].values;

          const refs = await replaceReferences(values, resolver);

          cr.spec.values = JSON.stringify(refs.values);

          cr.spec.references = refs.references;

          return cr;
        },

        identify() {
          return 'normalizer/ref-values';
        },
      },
    ];
  }
}

export async function replaceReferences(
  // Values to replace
  providerValues: any,

  resolveRef: Function,

  references: Map<string, any> = new Map(),
) {
  const values: { [key: string]: any } = {};
  const updatedReferences = references;

  for (const key in providerValues) {
    values[key] = await interpolateObject(
      providerValues[key],
      references,
      resolveRef,
    );
  }

  let secretRefCount = 0;

  for (const key in providerValues) {
    if (isRepoSecretRef(providerValues[key])) {
      values[key] = await interpolateSecretClaimRef(
        providerValues[key],
        references,
        // closure to increase the refCount and avoid collision
        () => secretRefCount++,
      );
    }
  }

  return { values, references: Array.from(updatedReferences.values()) };
}

async function interpolateObject(
  toInterpolate: any,
  references: Map<string, any>,
  resolveRef: Function,
): Promise<any> {
  switch (toInterpolate?.constructor) {
    case String: {
      const content = await replaceReferencesValues(
        toInterpolate,
        references,
        resolveRef,
      );

      return content;
    }

    case Array: {
      const interpolatedArray = [];

      for (const element of toInterpolate) {
        interpolatedArray.push(
          await interpolateObject(element, references, resolveRef),
        );
      }

      return interpolatedArray;
    }

    case Object: {
      const interpolatedObject: any = {};

      for (const key in toInterpolate) {
        interpolatedObject[key] = await interpolateObject(
          toInterpolate[key],
          references,
          resolveRef,
        );
      }

      return interpolatedObject;
    }

    default:
      return toInterpolate;
  }
}

async function replaceReferencesValues(
  contents: string,
  references: Map<string, any>,
  resolveRef: Function,
) {
  const regex = common.types.regex.TFWorkspaceRefRegex;

  let replacedContent = contents;

  for (const match of contents.matchAll(regex)) {
    const [matchStr, claimName, outputKey] = match;

    const cr = await resolveRef('TFWorkspaceClaim', claimName);

    if (!cr) throw new Error(`❌ Could not resolve reference ${claimName}`);

    const refName = `tfworkspace_${cr.metadata.name}.${outputKey}`;

    references.set(refName, {
      name: refName,
      ref: {
        kind: 'FirestartrTerraformWorkspace',
        name: cr.metadata.name,
        key: outputKey,
      },
    });

    replacedContent = replacedContent.replace(
      matchStr,
      `\${{ references.tfworkspace_${cr.metadata.name}.${outputKey} }}`,
    );
  }

  const secretsRegex = common.types.regex.SecretRefRegex;

  for (const match of contents.matchAll(secretsRegex)) {
    const [matchStr, claimName, outputKey] = match;

    const refName = `external_secret_${claimName}.${outputKey}`;

    const cr = await resolveRef('SecretsClaim', claimName);

    if (!cr) throw new Error(`❌ Could not resolve reference ${claimName}`);

    const crName = common.generic.normalizeName(claimName);

    references.set(refName, {
      name: refName,
      ref: {
        kind: 'ExternalSecret',
        name: cr.metadata.name,
        key: outputKey,
      },
    });

    const keyFound = cr.spec.data.find(
      (data: any) => data.secretKey === outputKey,
    );

    if (!keyFound) {
      throw new Error(
        `❌ Could not find key '${outputKey}' from ref '${matchStr}' in claim '${claimName}'`,
      );
    }

    replacedContent = replacedContent.replace(
      matchStr,
      `\${{ references.external_secret_${crName}.${outputKey} }}`,
    );
  }

  return replacedContent;
}

async function interpolateSecretClaimRef(
  secretClaimRef: string,
  references: Map<string, any>,
  getSecretRefCountF: Function,
) {
  const extractedSecretClaimRef = {
    ...extractRepoSecretRef(secretClaimRef),

    // force the kind to ALWAYS be a Secret
    kind: 'Secret',
  };

  // has already been visited
  const alreadyPresentKey = findSecretKey(extractedSecretClaimRef, references);

  if (alreadyPresentKey) return alreadyPresentKey;

  // new reference we have to build it
  const secretClaimRefInternalKey = `secret-ref-${getSecretRefCountF()}`;

  // we set the secret value
  references.set(secretClaimRefInternalKey, {
    name: secretClaimRefInternalKey,
    ref: extractedSecretClaimRef,
  });

  return secretClaimRefInternalKey;
}

function findSecretKey(secretClaimRef: any, references: Map<string, any>) {
  const entry = Array.from(references.entries()).find(([, value]) => {
    // Destructure the entry to easily access the value.

    // Check if the value is an object and matches all properties.
    return (
      typeof value === 'object' &&
      value !== null &&
      value.ref !== null &&
      typeof value.ref === 'object' &&
      value.ref.kind === secretClaimRef.kind &&
      value.ref.name === secretClaimRef.name &&
      value.ref.key === secretClaimRef.key
    );
  });

  // If a matching entry was found, return its key (the first element of the entry array).
  return entry ? entry[0] : undefined;
}
