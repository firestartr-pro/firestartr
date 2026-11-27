import { orgFromContext, resolveClaimsRepository } from '../context/resolve.js';
import { actionsSchemasDir } from '../schema/actionsSchemas.js';
import {
  type AppInputs,
  appInputsSchemaDir,
  loadAppInputsFile,
  validateAppInputs,
} from '../schema/appInputs.js';
import { claimSchemasDir } from '../schema/claimSchemas.js';
import { dotFirestartrSchemasDir } from '../schema/dotFirestartrSchemas.js';
import { vendorSchemasDir } from '../schema/vendorSchemas.js';

import type { PlanSchemaDirs } from './plan/index.js';

export interface LoadAppCommandInputsOptions {
  inputsPath: string;
  configRoot: string;
  app?: string;
  org?: string;
  claimsRepo?: string;
}

export interface LoadedAppCommandInputs {
  inputs: AppInputs;
  org: string;
  claimsRepoName: string;
  schemaDirs: PlanSchemaDirs;
}

export async function loadAppCommandInputs(
  options: LoadAppCommandInputsOptions,
): Promise<LoadedAppCommandInputs> {
  const schemasDir = appInputsSchemaDir(options.configRoot);
  const loaded = await loadAppInputsFile(options.inputsPath, schemasDir);
  if (!loaded.valid) {
    throw new Error(`Invalid inputs file:\n${loaded.errors.join('\n')}`);
  }

  const inputs: AppInputs = {
    ...loaded.data,
    ...(options.app !== undefined ? { app: options.app } : {}),
  };

  if (options.app !== undefined) {
    const revalidated = validateAppInputs(inputs, schemasDir);
    if (!revalidated.valid) {
      throw new Error(
        `Invalid --app value "${options.app}":\n${revalidated.errors.join('\n')}`,
      );
    }
  }

  const org =
    options.org ?? inputs.org ?? process.env.FSCRT_ORG ?? orgFromContext();
  if (!org) {
    throw new Error(
      'Organization is required: pass --org, set "org" in the inputs file, set FSCRT_ORG, or configure a default org.',
    );
  }

  const claimsTarget = resolveClaimsRepository(org, options.claimsRepo);

  return {
    inputs,
    org,
    claimsRepoName: claimsTarget.repo,
    schemaDirs: {
      claimSchemasDir: claimSchemasDir(options.configRoot),
      dotFirestartrSchemasDir: dotFirestartrSchemasDir(options.configRoot),
      actionsSchemasDir: actionsSchemasDir(options.configRoot),
      vendorDir: vendorSchemasDir(options.configRoot),
    },
  };
}
