export {
  TFProjectManager,
  DEFAULT_MIRROR_WARMUP_LIST,
  initializeMirrors,
} from './src';
import Ajv from 'ajv';
import schema from './src/schema';
import { TFProjectManager } from './src';
import * as mirrors from './src/mirror-repos';
import { TFProjectManagerRemote } from './src/project_tf_remote';

import log from './src/logger';

import type { ProcessHandler } from './src/process_handler';

const ajv = new Ajv();

const validate = ajv.compile(schema);

export interface WarmupMirrorsRefreshOptions {
  enabled?: boolean;
  runEvery?: number;
  beforeRefresh?: () => Promise<void>;
  onError?: (error: Error) => void | Promise<void>;
}

export interface WarmupMirrorsResult {
  success: string[];
  failed: { repo: string; error: string }[];
  initializeRefresher: (
    runEvery: number,
    beforeRefresh?: () => Promise<void>,
    onError?: (error: Error) => void | Promise<void>,
  ) => { stop: () => void };
  refresher?: { stop: () => void };
}

export async function warmupMirrors(
  repos?: ReadonlyArray<string>,
  refreshOptions: WarmupMirrorsRefreshOptions = { enabled: false },
): Promise<WarmupMirrorsResult> {
  const initializedMirrors = await mirrors.initializeMirrors(repos);

  if (!refreshOptions.enabled) {
    return initializedMirrors;
  }

  if (
    typeof refreshOptions.runEvery !== 'number' ||
    refreshOptions.runEvery <= 0
  ) {
    throw new Error(
      'refreshOptions.runEvery must be a positive number when refresh is enabled',
    );
  }

  const refresher = initializedMirrors.initializeRefresher(
    refreshOptions.runEvery,
    refreshOptions.beforeRefresh,
    refreshOptions.onError,
  );

  return {
    ...initializedMirrors,
    refresher,
  };
}

export function validateContext(context: any) {
  const valid = validate(context);

  if (!valid) {
    throw new Error(`Invalid context: ${JSON.stringify(validate.errors)}`);
  }
}

// CLI API
export async function run() {
  const [command, contextarg] = process.argv.slice(2);

  const context = JSON.parse(contextarg);

  validateContext(context);

  const tfProject = new TFProjectManager(context);

  await execCommand(command, tfProject);
}

// Programatic API
export async function runTerraformProvisioner(
  context: any,
  command = 'init',
  streaming?: any,
  customArgs?: any,
  ctl?: ProcessHandler,
) {
  log.info(`Running command ${command} on a ${context.type} project`);

  validateContext(context);

  let tfProject: any = {};

  if (context.type === 'Inline') {
    tfProject = new TFProjectManager(context);
  } else if (context.type === 'Remote') {
    tfProject = new TFProjectManagerRemote(context);
  }

  if (streaming) {
    tfProject.setStreamCallbacks(streaming.fnData, streaming.fnEnd);
  }

  if (customArgs) {
    tfProject.customArgs = customArgs;
  }

  if (['custom-import', 'import-with-reimport', 'import'].includes(command)) {
    if (command === 'custom-import' && !tfProject.customArgs) {
      throw new Error(
        '[terraform-provisioner]: custom-import needs customArgs, none has been passed',
      );
    }
    tfProject.onImport = true;
    if ('ctx' in tfProject && tfProject.ctx) tfProject.ctx.importMode = true;
    else if ('context' in tfProject && tfProject.context)
      tfProject.context.importMode = true;
  }

  if (command === 'destroy-state-only') {
    log.info('[gh-provisioner] WARNING! is a destroy-state-only');
  }

  if (ctl) {
    tfProject.ctl = ctl as ProcessHandler;
  }

  const output = await execCommand(command, tfProject);

  return output;
}

async function execCommand(command: string, tfProject: TFProjectManager) {
  log.info(`Executing command ${command} on ${tfProject.projectPath}`);

  // Handle no-build commands FIRST
  if (command === 'tear-up-project') {
    if (tfProject.tearUpProject) {
      await tfProject.tearUpProject();
      return { tornUp: true };
    }
    throw new Error('tearUpProject not implemented for this context type');
  }
  if (command === 'debug') {
    return;
  }

  await tfProject.build();

  switch (command) {
    case 'init':
      await tfProject.__init();
      break;

    case 'validate':
      await tfProject.validate();
      break;

    case 'plan':
      await tfProject.plan('human');
      break;

    case 'plan-json':
      await tfProject.plan('json');
      break;

    case 'apply':
      await tfProject.apply();
      break;

    case 'plan-destroy':
      await tfProject.planDestroy('human');
      break;

    case 'plan-destroy-json':
      await tfProject.planDestroy('json');
      break;

    case 'custom-command':
      await tfProject.customCommand();
      break;

    case 'custom-import':
      await tfProject.customImport();
      break;

    case 'destroy-state-only':
      await tfProject.destroyStateOnly();
      break;

    case 'destroy':
      await tfProject.destroy();
      break;

    case 'output':
      return await tfProject.output();

    default:
      throw new Error(`Unknown command: ${command}`);
  }

  return tfProject.getOutput();
}
