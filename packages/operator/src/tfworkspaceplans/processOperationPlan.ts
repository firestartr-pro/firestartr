import { OperationType } from '../informer';
import { addPlanStatusCheck } from '../ctl';
import {
  tryCreateErrorSummary,
  publishPlan,
  extractPrInfo,
} from '../user-feedback-ops/user-feedback-ops';
import { runTerraformProvisioner } from 'terraform_provisioner';
import {
  extractErrorDetails,
  replaceConfigSecrets,
  replaceInlineSecrets,
} from '../utils';
import log from '../logger';
import * as fs from 'fs';
import * as path from 'path';
import { PLAN_DEFAULT_ERROR_MESSAGE } from '../utils/operationErrorMessages';

const TF_PROJECTS_PATH = '/tmp/tfworkspaces';

export function processOperationPlan(
  item: any,
  op: OperationType,
  handler: any,
) {
  try {
    clearLocalTfProjects();

    const policy = getPolicy(item);

    if (policy === 'observe' || policy === 'apply') {
      return plan(item, op, handler);
    } else if (policy === 'destroy') {
      return plan(item, op, handler, 'plain-text', 'plan-destroy');
    } else {
      return nothing(item, op, handler);
    }
  } catch (e: any) {
    log.error('TFWORKSPACE_PROCESSOR_PLAN_ERROR', {
      metadata: { item, error: e, op },
    });

    throw e;
  }
}

async function* nothing(item: any, op: OperationType, _handler: any) {
  yield {
    item,
    reason: op,
    type: 'NOTHING',
    status: 'True',
    message: 'NOTHING',
  };
}

async function* plan(
  item: any,
  op: OperationType,
  handler: any,
  format: 'plain-text' | 'json' = 'plain-text',
  action = 'plan',
) {
  if (format === 'plain-text') {
    for await (const transition of doPlanPlainTextFormat(
      item,
      op,
      handler,
      action,
    )) {
      yield transition;
    }
  } else if (format === 'json') {
    for await (const transition of doPlanJSONFormat(
      item,
      op,
      handler,
      action,
    )) {
      yield transition;
    }
  }
}

async function* doPlanPlainTextFormat(
  item: any,
  op: OperationType,
  handler: any,
  action: string,
) {
  let error = false;

  try {
    yield {
      item,
      reason: op,
      type: 'ERROR',
      status: 'False',
      message: 'doPlanPlainTextFormat',
    };

    yield {
      item,
      reason: op,
      type: 'PLAN_PUBLISHED',
      status: 'False',
      message: 'doPlanPlainTextFormat',
    };

    yield {
      item,
      reason: op,
      type: 'PLANNING',
      status: 'True',
      message: 'Planning process started',
    };

    const deps = await handler.resolveReferences();

    log.info('TFWORKSPACE_PROCESSOR_PLAN_ASSESS_DEPS', {
      metadata: { item, deps },
    });

    const context: any = buildProvisionerContext(item, deps);

    if (item.metadata.annotations['firestartr.dev/last-state-pr'] || false) {
      await addPlanStatusCheck(
        item.metadata.annotations['firestartr.dev/last-state-pr'],
        'Terraform plan in progress...',
      );
    }

    const tfPlanOutput: any = await runTerraformProvisioner(context, action);

    yield {
      item,
      reason: op,
      type: 'ERROR',
      status: 'False',
      message: 'doPlanPlainTextFormat',
    };

    yield {
      item,
      reason: op,
      type: 'PLAN_PUBLISHED',
      status: 'True',
      message: 'doPlanPlainTextFormat',
    };

    yield {
      item,
      reason: op,
      type: 'PLANNING',
      status: 'False',
      message: 'Planning process started',
    };

    if (item.metadata.annotations['firestartr.dev/last-state-pr'] || false) {
      await addPlanStatusCheck(
        item.metadata.annotations['firestartr.dev/last-state-pr'],
        tfPlanOutput,
        'completed',
      );
    }

    const { prNumber, repo, org } = extractPrInfo(
      item,
      'firestartr.dev/pull-request-plan',
    );
    await publishPlan(item, tfPlanOutput, prNumber, repo, org, true);
  } catch (e: any) {
    error = true;
    const { output: errorMsg } = extractErrorDetails(e);

    const { prNumber, repo, org } = extractPrInfo(
      item,
      'firestartr.dev/pull-request-plan',
    );
    await publishPlan(item, errorMsg, prNumber, repo, org, false);

    log.error('TFWORKSPACE_PROCESSOR_PLAN_OBSERVING_ERROR', {
      metadata: { item, error: e },
    });

    const summaryText: string = tryCreateErrorSummary(
      'Terraform Plan failed',
      errorMsg,
    );

    if (item.metadata.annotations['firestartr.dev/last-state-pr'] || false) {
      await addPlanStatusCheck(
        item.metadata.annotations['firestartr.dev/last-state-pr'],
        summaryText,
        'completed',
        true,
      );
    }

    void handler.error();

    if (errorMsg) {
      await handler.writeTerraformOutputInTfResult(item, errorMsg);
    }
  } finally {
    if (error) {
      yield {
        item,
        reason: op,
        type: 'PROVISIONED',
        status: 'False',
        message: PLAN_DEFAULT_ERROR_MESSAGE,
      };

      yield {
        item,
        reason: op,
        type: 'PLANNING',
        status: 'False',
        message: PLAN_DEFAULT_ERROR_MESSAGE,
      };

      yield {
        item,
        reason: op,
        type: 'ERROR',
        status: 'True',
        message: PLAN_DEFAULT_ERROR_MESSAGE,
      };
    }
  }
}

async function* doPlanJSONFormat(
  item: any,
  op: OperationType,
  handler: any,
  action: string,
) {
  let error = false;

  try {
    yield {
      item,
      reason: op,
      type: 'ERROR',
      status: 'False',
      message: 'doPlanJSONFormat',
    };

    yield {
      item,
      reason: op,
      type: 'PLAN_PUBLISHED',
      status: 'False',
      message: 'doPlanJSONFormat',
    };

    yield {
      item,
      reason: op,
      type: 'PLANNING',
      status: 'True',
      message: 'Planning process started',
    };

    const deps = await handler.resolveReferences();

    log.info('TFWORKSPACE_PROCESSOR_PLAN_DO_PLAN_ASSESS_DEPS', {
      metadata: { item, deps },
    });

    const context: any = buildProvisionerContext(item, deps);

    if (item.metadata.annotations['firestartr.dev/last-state-pr'] || false) {
      await addPlanStatusCheck(
        item.metadata.annotations['firestartr.dev/last-state-pr'],
        'Terraform plan in progress...',
      );
    }

    const tfPlan: any = await runTerraformProvisioner(context, action);

    if (tfPlan.summary.hasChanges()) {
      yield {
        item,
        reason: op,
        type: 'PROVISIONED',
        status: 'False',
        message: 'Plan has changes',
      };

      yield {
        item,
        reason: op,
        type: 'OUT_OF_SYNC',
        status: 'True',
        message: tfPlan.summary.toString(),
      };
    } else {
      yield {
        item,
        reason: op,
        type: 'PROVISIONED',
        status: 'True',
        message: 'Plan has no changes',
      };

      yield {
        item,
        reason: op,
        type: 'OUT_OF_SYNC',
        status: 'False',
        message: 'Plan has no changes',
      };
    }

    yield {
      item,
      reason: op,
      type: 'LAST_PLAN_DETAILS',
      status: 'Unknown',
      message: JSON.stringify(tfPlan.detailedBriefing),
    };

    yield {
      item,
      reason: op,
      type: 'PLANNING',
      status: 'False',
      message: 'Planning process finished',
    };

    if (item.metadata.annotations['firestartr.dev/last-state-pr'] || false) {
      await addPlanStatusCheck(
        item.metadata.annotations['firestartr.dev/last-state-pr'],
        tfPlan,
        'completed',
      );
    }
  } catch (e: any) {
    error = true;
    const { output: errorMsg } = extractErrorDetails(e);

    console.error(e);

    log.error('TFWORKSPACE_PROCESSOR_PLAN_DO_PLAN_ERROR', {
      metadata: { item, error: e },
    });

    void handler.error();

    if (errorMsg) {
      await handler.writeTerraformOutputInTfResult(item, errorMsg);
    }
  } finally {
    if (error) {
      yield {
        item,
        reason: op,
        type: 'PROVISIONED',
        status: 'False',
        message: PLAN_DEFAULT_ERROR_MESSAGE,
      };

      yield {
        item,
        reason: op,
        type: 'PLANNING',
        status: 'False',
        message: PLAN_DEFAULT_ERROR_MESSAGE,
      };

      yield {
        item,
        reason: op,
        type: 'OUT_OF_SYNC',
        status: 'False',
        message: PLAN_DEFAULT_ERROR_MESSAGE,
      };

      yield {
        item,
        reason: op,
        type: 'ERROR',
        status: 'True',
        message: PLAN_DEFAULT_ERROR_MESSAGE,
      };
    }
  }
}

/**
 * @description Adapts the CR to the format expected by the terraform provisioner
 * @param item  - CR to be applied
 * @param deps - Dependencies
 */
export function buildProvisionerContext(item: any, deps: any) {
  const context: any = {};

  context['type'] = item.spec.source;

  context['inline'] = item.spec.module;

  context['module'] = item.spec.module;

  context['values'] = JSON.parse(item.spec.values);

  const result = adaptProviders(item, deps);

  context['requiredProviders'] = result.providers;

  context['secrets'] = result.secrets;

  context['backend'] = adaptBackend(item, deps);

  context['tfStateKey'] = item.spec.firestartr.tfStateKey;

  context['references'] = resolveReferences(item, deps);

  context['projectPath'] = path.join(
    TF_PROJECTS_PATH,
    item.spec.firestartr.tfStateKey,
  );

  return context;
}

function getRefContextFromCr(cr: any, deps: any) {
  const secrets: any = {};

  // check first there are any secrets to resolve
  if (cr.spec.secrets === undefined) return secrets;

  for (const i of Object.entries(cr.spec.secrets)) {
    const [objectKey, value]: [string, any] = i;

    const { key, name } = value.secretRef;

    const secretDepKeyName = `Secret-${name}`;

    const secret: any = deps[secretDepKeyName as keyof typeof deps];

    if (secret.cr.data[key] === undefined)
      throw new Error(`Secret ${name} does not contain key ${key}`);

    secrets[objectKey] = Buffer.from(secret.cr.data[key], 'base64');
  }

  return secrets;
}

function adaptProviders(item: any, deps: any) {
  const result: any = {};

  result['secrets'] = [];

  result['providers'] = [];

  if (item.spec.context.providers) {
    for (const p of item.spec.context.providers) {
      const { provider, secrets } = adaptProvider(p, deps);

      result['providers'].push(provider);

      result['secrets'] = result['secrets'].concat(secrets);
    }
  }

  return result;
}

/**
 * @param item
 * @param deps
 * @description Adapts the provider configuration to the format expected by the terraform provisioner
 */
function adaptProvider(providerFromItem: any, deps: any) {
  const provider: any = {};

  const providerName = `FirestartrProviderConfig-${providerFromItem.ref.name}`;

  const providerDependency = deps[providerName].cr;

  const providerSecrets = getRefContextFromCr(providerDependency, deps);

  const providerConfigData = replaceConfigSecrets(
    JSON.parse(providerDependency.spec.config),
    providerSecrets,
  );

  const providerInlineData = replaceInlineSecrets(
    providerDependency.spec.inline,
    providerSecrets,
  );

  provider['name'] = providerDependency.spec.type;

  provider['version'] = providerDependency.spec.version;

  provider['source'] = providerDependency.spec.source;

  provider['inline'] = providerInlineData;

  provider['config'] = providerConfigData;

  const secrets: any[] = [];

  if (providerDependency.spec.env) {
    const secretsEnv = JSON.parse(providerDependency.spec.env ?? {});

    for (const key of Object.keys(secretsEnv)) {
      secrets.push({
        key: key,
        value: secretsEnv[key],
      });
    }
  }

  return { provider, secrets };
}

/**
 * @description Adapts the backend configuration to the format expected by the terraform provisioner
 * @param item  - CR to be applied
 * @param deps  - Dependencies
 */
function adaptBackend(item: any, deps: any) {
  const backend: any = {};

  const backendName = `FirestartrProviderConfig-${item.spec.context.backend.ref.name}`;

  const backendDependency = deps[backendName].cr;

  const backendSecrets = getRefContextFromCr(backendDependency, deps);

  const providerConfigData = replaceConfigSecrets(
    JSON.parse(backendDependency.spec.config),
    backendSecrets,
  );

  const providerInlineData = replaceInlineSecrets(
    backendDependency.spec.inline,
    backendSecrets,
  );

  backend[backendDependency.spec.type] = {};

  backend[backendDependency.spec.type]['config'] = providerConfigData;

  backend[backendDependency.spec.type]['inline'] = providerInlineData;

  return backend;
}

/**
 * @param item  - CR to be applied
 * @param deps  - Dependencies
 * @description Resolves references to secrets, provided by the user in the CR
 */
function resolveReferences(item: any, deps: any) {
  try {
    const references: any = {};

    const itemReferences = item.spec.references;
    for (const iRef of itemReferences) {
      const ref = deps[`${iRef.ref.kind}-${iRef.ref.name}`];

      if (!ref) {
        throw new Error(
          `Reference ${iRef.ref.kind}-${iRef.ref.name} not found`,
        );
      }

      if (!ref.secret || !ref.secret.data) {
        throw new Error(
          `❌ No outputs secret found in reference ${iRef.ref.name}`,
        );
      }

      let b64Decoded = '';

      try {
        if (ref.secret.data['outputs']) {
          b64Decoded = Buffer.from(
            ref.secret.data['outputs'],
            'base64',
          ).toString('utf-8');
        } else if (Object.keys(ref.secret.data).length > 0) {
          const resultObj: any = {};

          for (const key in ref.secret.data) {
            resultObj[key] = Buffer.from(
              ref.secret.data[key],
              'base64',
            ).toString('utf-8');
          }

          b64Decoded = JSON.stringify(resultObj);
        }
      } catch (e: any) {
        throw new Error(
          `❌ Error decoding outputs from secret ${ref.secret.metadata.name}: ${e}`,
        );
      }

      let outputs: any = {};

      try {
        outputs = JSON.parse(b64Decoded);
      } catch (e: any) {
        console.error(e);

        throw new Error(
          `❌ Error parsing outputs from secret ${ref.secret.metadata.name}: ${e}`,
        );
      }

      if (!outputs[iRef.ref.key]) {
        throw new Error(getErrorOutputMessage(item, iRef.ref.key, ref));
      }

      if (ref.secret.data['outputs']) {
        references[iRef.name] = outputs[iRef.ref.key].value;
      } else {
        references[iRef.name] = outputs[iRef.ref.key];
      }
    }

    return references;
  } catch (e: any) {
    // Throws an object instead of an error because that's how Terraform does it,
    // and we stringify it's errors in our catch blocks. Throwing an actual
    // Error object results in "{}" being written to the CR
    throw { error: `resolving references: ${e}` };
  }
}

function clearLocalTfProjects() {
  fs.rmSync(
    TF_PROJECTS_PATH,

    { recursive: true, force: true },
  );
}

function getErrorOutputMessage(cr: any, key: string, ref: any) {
  if (cr.spec.source === 'Remote') {
    return `

    ❌ No output ${key} found in secret "${ref.secret.metadata.name}" .

    ❗❕ Your terraform project has not the output "${key}" .

    Maybe you forgot to add it or your reference is wrong.

    🔗 Terraform project: ${cr.spec.module}

    🖹 Output example:

    ... your terraform code ...

    # missing output
    output "${key}" {
      value = <your_value>
    }

    `;
  } else if (cr.spec.source === 'Inline') {
    return `❗❕ Could not find output '${key}' in inline module:

      ${cr.spec.module}
    `;
  } else {
    throw new Error(`❌ Source ${cr.spec.source} not supported`);
  }
}

function getPolicy(item: any) {
  const policy =
    item.metadata.annotations &&
    item.metadata.annotations['firestartr.dev/policy'];

  if (policy) return policy;
}
