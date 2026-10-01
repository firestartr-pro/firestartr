import { isDirectory, isFile, slurpFile } from './common';

import jsonpatch from 'fast-json-patch';

import * as path from 'path';

import common from 'catalog_common';

import Ajv from 'ajv';

import schema from './schema';

export default function validate(featurePath: string) {
  __validateDirStructure(featurePath);

  const configData: any = __validateFeatureConfig(featurePath);

  __validateFeatureConfigData(configData);

  __validateJsonPatches(configData);

  return configData;
}

function __validateDirStructure(featurePath: string) {
  if (!isDirectory(featurePath)) {
    throw new Error(`Feature: ${featurePath} not a directory`);
  }

  if (!isFile(path.join(featurePath, 'config.yaml'))) {
    throw new Error(
      `Feature: ${featurePath}/config.yaml not found or not a file`,
    );
  }
}

function __validateFeatureConfig(featurePath: string) {
  try {
    const configDataRaw: string = slurpFile(
      path.join(featurePath, 'config.yaml'),
    );

    const configData: any = common.io.fromYaml(configDataRaw);

    return configData;
  } catch (error) {
    throw new Error(`Feature: loading config.yaml: ${error}`);
  }
}

function __validateFeatureConfigData(configData: any) {
  // Detect old provider-keyed claimPatches shape for migration hint.
  if (
    configData.claimPatches &&
    !Array.isArray(configData.claimPatches) &&
    typeof configData.claimPatches === 'object'
  ) {
    throw new Error(
      `Feature: config.yaml invalid claimPatches: expected flat array of claimPatches (claim-relative pointers like /annotations/backstage.io~1techdocs-ref), but got provider-keyed object ${JSON.stringify(Object.keys(configData.claimPatches))}. Migrate: claimPatches: { catalog: [...] } → claimPatches: [{ op, path: /annotations/backstage.io~1techdocs-ref, value }]. $ref paths also migrate: [spec, org] → [providers, github, org], [metadata, annotations, firestartr.dev/external-name] → [providers, github, name]`,
    );
  }

  const ajv = new Ajv({
    allowUnionTypes: true,
  });

  const allowNonAnchoredPaths =
    configData.meta?.allow_non_anchored_paths === true;

  const activeSchema = allowNonAnchoredPaths
    ? stripAnchoringConstraints(schema)
    : schema;

  const validate = ajv.compile(activeSchema);

  const valid = validate(configData);

  if (!valid) {
    throw new Error(
      `Feature: config.yaml invalid ${JSON.stringify(validate.errors)}`,
    );
  }
}

function stripAnchoringConstraints(schemaDef: any): any {
  const clone = JSON.parse(JSON.stringify(schemaDef));

  delete clone.definitions.File.properties.src.not;

  delete clone.definitions.File.properties.dest.not;

  delete clone.definitions.root.properties.filesTemplates.items.not;

  return clone;
}

function __validateJsonPatches(configData: any) {
  const patches = configData.claimPatches;

  if (!Array.isArray(patches)) return;

  const err = jsonpatch.validate(patches);

  if (err) {
    throw new Error(
      `Feature: config.yaml -> claimPatches: invalid claimPatches ${JSON.stringify(
        err.message ?? err,
      )}`,
    );
  }

  // Legacy provider-keyed `patches` field is accepted for backward
  // compatibility. Its values are per-provider arrays of the same Patch
  // shape, so validate each of them too.
  const legacyPatches: any = configData.patches;

  if (legacyPatches && typeof legacyPatches === 'object') {
    for (const key of Object.keys(legacyPatches)) {
      const arr: any = legacyPatches[key];

      if (!Array.isArray(arr)) {
        throw new Error(
          `Feature: config.yaml -> patches.${key}: expected an array of patches, got ${typeof arr}`,
        );
      }

      const legacyErr = jsonpatch.validate(arr);

      if (legacyErr) {
        throw new Error(
          `Feature: config.yaml -> patches.${key}: invalid patch ${JSON.stringify(
            legacyErr.message ?? legacyErr,
          )}`,
        );
      }
    }
  }
}
