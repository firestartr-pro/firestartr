import { initSystem } from './src';

import { Entity } from './src/entities';

import { runOnTerraform } from './src/tp_bridge';

import log from './src/logger';

import { debugTerraformOutput, endDebug, initDebug } from './src/debug';

import common from 'catalog_common';

export async function runGhProvisioner(data: any, opts: any) {
  // Step 1: Workspace session ID (non-debug runs)
  function generateSessionId() {
    return Math.random().toString(36).substring(2, 6);
  }
  let sessionId: string | null = null;
  let sessionProjectPath: string | null = null;
  log.debug(
    '[gh-provisioner] runGhProvisioner options keys:',
    Object.keys(opts || {}),
  );

  let tfOp = inferTFOperation(data.mainCr, opts);

  if (tfOp === 'nothing' && opts.debug) {
    tfOp = 'debug';
  }

  log.info(`[gh-provisioner] Starting runGhProvisioner with tf op ${tfOp}`);

  sendWarnings();

  let entity: Entity | undefined;
  let synthFinished = false;
  let provisioningError: Error | null = null;

  try {
    entity = await initSystem(data.mainCr, data.deps);

    // Generate per-execution sessionId and session projectPath
    // For debug mode we want a deterministic per-resource folder (no random suffix)
    // Use the resource's tfStateKey when present for stability, otherwise fall
    // back to metadata UID-like deterministic id stored on the CR name/fields.
    sessionId = generateSessionId();
    if (entity.inDebugMode) {
      // Use deterministic per-resource folder under /tmp/gh-debug. Include
      // the tfStateKey as a suffix when available to avoid collisions for
      // resources (like features) that share a human-friendly name.
      const rawName = entity.cr.name as string;
      const baseName = rawName.replace(
        /-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/,
        '',
      );
      const tfStateKey = entity.cr?.spec?.firestartr?.tfStateKey;
      const safeKey =
        typeof tfStateKey === 'string' && tfStateKey.trim() !== ''
          ? tfStateKey
          : null;
      sessionProjectPath = `/tmp/gh-debug/${entity.cr.kind.toLowerCase()}-${baseName}${safeKey ? `-${safeKey}` : ''}`;
    } else {
      sessionProjectPath = `/tmp/gh-workspaces/${entity.cr.kind.toLowerCase()}-${entity.cr.name}-${sessionId}`;
    }
    // Attach session fields to the entity for downstream access
    entity.sessionId = sessionId;
    entity.sessionProjectPath = sessionProjectPath;

    // ---------------------------------------
    // for subentity calling (if necessary)
    // ---------------------------------------
    entity.deps = data.deps;

    // ---------------------------------------
    // set stream logs (if available)
    // ---------------------------------------
    if ('logStreamCallbacksGHProvisioner' in opts) {
      entity.streamGHProvisioner = opts.logStreamCallbacksGHProvisioner;
    }

    if ('logStreamCallbacksTF' in opts) {
      entity.streamTFProvisioner = opts.logStreamCallbacksTF;
    }

    // ---------------------------------------
    // debug mode ( if necessary)
    // ---------------------------------------
    if (entity.inDebugMode) {
      // [gh-provisioner] enters in debug mode (info only, no longer logged)

      await initDebug(entity, data.deps);
    }

    log.debug(
      `[gh-provisioner] system initiated for resource:  ${entity.k8sId}`,
    );

    // ---------------------------------------
    // ok let's start the ball
    // ---------------------------------------

    await entity.prepareToLoad(tfOp);

    await entity.loadResources(tfOp);

    log.debug(
      `[gh-provisioner] resources loaded for resources: ${entity.k8sId}`,
    );

    synthFinished = true;

    // ---------------------------------------
    // run the terraform part
    // ---------------------------------------
    entity._terraformHasRun = true;
    const operationOutputs = await runOnTerraform(
      entity,
      tfOp,
      undefined,
      opts,
    );

    log.info(`[gh-provisioner] op ${tfOp} terminated`);

    // ---------------------------------------
    // preparing the outputs
    // ---------------------------------------

    if (tfOp === 'debug' || tfOp === 'nothing' || isPlanOperation(tfOp)) {
      log.info(
        `[gh-provisioner] ${entity.k8sId} on ${tfOp}: post provision is skipped`,
      );
    } else {
      log.info(`[gh-provisioner] running post provision for ${entity.k8sId}`);

      await entity.postProvision(tfOp);

      log.debug(`[gh-provisioner] output for ${entity.k8sId}`);

      const output = await runOnTerraform(entity, 'output');

      if (entity && entity.inDebugMode) {
        await debugTerraformOutput(entity, output);
      }

      // we send the json output
      'fJsonOutput' in opts && opts['fJsonOutput'](output);
    }

    return operationOutputs;
  } catch (err: any) {
    const message = err instanceof Error ? err.message : String(err);

    log.error(`[gh-provisioner] Error running runGhProvisioner: ${message}`);

    if (!synthFinished && entity) entity.synthEnd(message);

    if (entity && entity.inDebugMode && synthFinished) {
      await debugTerraformOutput(entity, message);
    }

    provisioningError = new Error(
      `[gh-provisioner] Error running runGhProvisioner: ${message}`,
    );
    throw provisioningError;
  } finally {
    if (entity && entity.inDebugMode) {
      log.info('[gh-provisioner] stops debug mode');
      await endDebug(entity);
    }
    // Tear down workspace ONLY if not in debug mode
    else if (
      entity &&
      entity._terraformHasRun &&
      entity.sessionProjectPath &&
      !entity.inDebugMode &&
      !entity.sessionProjectPath.startsWith('/tmp/gh-debug/')
    ) {
      try {
        log.info(
          `[gh-provisioner] tearing down workspace at ${entity.sessionProjectPath}`,
        );
        await runOnTerraform(entity, 'tear-up-project');
      } catch (tearErr) {
        log.error(`[gh-provisioner] Failed to tear down workspace: ${tearErr}`);
        if (!provisioningError) {
          // eslint-disable-next-line no-unsafe-finally
          throw new Error(
            `[gh-provisioner] Workspace cleanup failed: ${tearErr}`,
          );
        }
      }
    } else if (
      entity &&
      entity.sessionProjectPath &&
      !entity.inDebugMode &&
      entity.sessionProjectPath.startsWith('/tmp/gh-debug/')
    ) {
      log.warn(
        '[gh-provisioner] SKIPPING teardown: Refusing to delete debug-mode workspace at ' +
          entity.sessionProjectPath,
      );
    }
  }
}

function inferTFOperation(cr: any, opts: any) {
  const isImport = cr?.metadata?.annotations[
    common.generic.getFirestartrAnnotation('import')
  ]
    ? true
    : false;

  const needsReimport = cr?.metadata?.annotations[
    common.generic.getFirestartrAnnotation('needs-re-import')
  ]
    ? true
    : false;

  log.debug(
    '[gh-provisioner] inferTFOperation options keys:',
    Object.keys(opts || {}),
  );

  const operation = opts.plan
    ? 'plan'
    : opts.planDestroy
      ? 'plan-destroy'
      : opts.delete
        ? 'destroy'
        : isImport || opts.import
          ? needsReimport
            ? 'import-with-reimport'
            : 'import'
          : opts.create
            ? 'apply'
            : opts.update
              ? 'apply'
              : 'nothing';

  //opts.import && opts.skipPlan && isImport
  //  ? 'IMPORT_SKIP_PLAN'

  return operation;
}

function isPlanOperation(tfOp: string) {
  return tfOp === 'plan' || tfOp === 'plan-destroy';
}

function sendWarnings() {
  if (process.env['AVOID_PROVIDER_SECRET_ENCRYPTION']) {
    console.warn(`
 ╔════════════════════════════════════════════════════════════════════════════╗
 ║                                                                            ║
 ║                  !!!  D A N G E R   Z O N E   A C T I V E  !!!             ║
 ║                                                                            ║
 ║  Custom secret generator function is ACTIVE                                ║
 ║                                                                            ║
 ║  → Using: 'process.env[AVOID_PROVIDER_SECRET_ENCRYPTION]'                  ║
 ║                                                                            ║
 ║  Encryption bypass flag: 'YES - SECRETS WILL BE STORED IN PLAIN TEXT!'     ║
 ║                                                                            ║
 ║  This is a VERY DANGEROUS code path in most environments.                  ║
 ║  Make sure you understand the security implications!                       ║
 ║                                                                            ║
 ║  Recommended only for: local dev / tests / emergency recovery              ║
 ║                                                                            ║
 ╚════════════════════════════════════════════════════════════════════════════╝
`);
  }
}

export default {
  runGhProvisioner,
};
