import { getItemByItemPath, writeStatus } from './ctl';

import log from './logger';

import { setHighPriorityStatus } from './high_priority_status';

import common from 'catalog_common';

export type NeedsCreationOrUpdate = {
  needs: boolean;
  reason?: string;
};

export async function upsertInitialStatus(
  pluralKind: string,
  namespace: string,
  item: any,
) {
  item = await getItemByItemPath(
    `${namespace}/${pluralKind}/${item.metadata.name}`,
  );

  if (!('status' in item)) item.status = {};

  if (!('conditions' in item.status)) item.status.conditions = [];

  await writePrioritizedStatus(pluralKind, namespace, item);
}

export async function needsProvisioningOnCreateOrUpdate(
  cr: any,
): Promise<NeedsCreationOrUpdate> {
  const fCrLog = (cr: any) => `The item ${cr.kind}: ${cr.metadata.name}`;

  // NO STATUS
  if (!('status' in cr) || !('conditions' in cr.status)) {
    log.debug(
      `The custom resource '${cr.kind}/${cr.metadata.name}' is missing a status and any conditions.`,
    );
    return { needs: true, reason: 'CREATED' };
  }

  // there is a force by annotation?
  if (shouldForceReconcileByAnnotation(cr)) {
    log.debug(
      `The custom resource '${cr.kind}/${cr.metadata.name}' has a newer '${common.generic.getFirestartrAnnotation('reconcile-at')}' annotation than the latest condition update time, so a force-reconcile will be triggered.`,
    );
    return { needs: true, reason: 'FORCE_RECONCILE_ANNOTATION' };
  }

  // ERROR
  const errCond = getConditionByType(cr.status.conditions, 'ERROR');

  if (errCond && errCond.status === 'True') {
    log.debug(
      `Skipping the provisioning process for custom resource '${cr.kind}/${cr.metadata.name}' due to a status error.`,
    );
    return { needs: false };
  }

  // PROVISIONED
  const provCond = getConditionByType(cr.status.conditions, 'PROVISIONED');

  if (provCond && provCond.status === 'True') {
    if (provCond.observedGeneration >= cr.metadata.generation) {
      log.debug(
        `The custom resource '${cr.kind}/${cr.metadata.name}' is already provisioned; skipping the process.`,
      );

      return { needs: false };
    } else {
      log.debug(
        `The custom resource '${cr.kind}/${cr.metadata.name}' is already provisioned but it has spec changes not observed (${provCond.observedGeneration} >= ${cr.metadata.generation}); handling.`,
      );
      return { needs: true, reason: 'UPDATED' };
    }
  }

  // DELETED
  const delCond = getConditionByType(cr.status.conditions, 'DELETED');

  if (
    delCond &&
    delCond.status === 'True' &&
    delCond.observedGeneration >= cr.metadata.generation
  ) {
    log.debug(
      `The custom resource '${cr.kind}/${cr.metadata.name}' has already been deleted; no action is required.`,
    );
    return { needs: false };
  }

  // PROVISIONING
  const provisioningCondition = getConditionByType(
    cr.status.conditions,
    'PROVISIONING',
  );

  if (provisioningCondition && provisioningCondition.status === 'True') {
    log.debug(
      `The custom resource '${cr.kind}/${cr.metadata.name}' is currently in a provisioning or reprovisioning state.`,
    );

    return { needs: true, reason: 'UPDATED' };
  }

  log.debug(
    `Skipping the provisioning process for custom resource '${cr.kind}/${cr.metadata.name}' because its current state is not handled.`,
  );
  return { needs: false };
}

export function shouldForceReconcileByAnnotation(cr: any): boolean {
  const annotationType = common.generic.getFirestartrAnnotation('reconcile-at');
  const annotationValue = cr.metadata?.annotations?.[annotationType];
  if (!annotationValue) {
    return false;
  }

  log.debug(
    `Found annotation '${annotationType}' with value '${annotationValue}' on ${cr.metadata.name}`,
  );

  const annotationTime = new Date(annotationValue).getTime();
  if (isNaN(annotationTime)) {
    log.warn(
      `Timestamp is invalid for the annotation ${cr.kind}/${cr.metadata?.name || 'unknown'}: ${annotationValue}`,
    );
    return false;
  }

  // Find the most recent timestamp across all conditions
  let latestConditionTime = 0;

  for (const condition of cr.status?.conditions || []) {
    const timeStr = condition.lastUpdateTime || condition.lastTransitionTime;
    if (timeStr) {
      const conditionTime = new Date(timeStr).getTime();
      if (!isNaN(conditionTime) && conditionTime > latestConditionTime) {
        latestConditionTime = conditionTime;
      }
    }
  }

  const shouldForce = annotationTime > latestConditionTime;

  log.debug(
    `Evaluating force-reconcile for ${cr.metadata.name}: annotation time (${new Date(annotationTime).toISOString()}) vs latest condition time (${new Date(latestConditionTime).toISOString()})`,
    { metadata: { shouldForce } },
  );

  if (shouldForce) {
    log.info(
      `force-reconcile activated for ${cr.metadata.name} → annotation (${annotationValue}) is newer than latest condition time (${new Date(latestConditionTime).toISOString()})`,
    );
  }

  return shouldForce;
}

export async function updateSyncTransition(
  itemPath: string,
  reason: string,
  lastSyncTime: string,
  nextSyncTime: string,
  message: string,
  status: string,
) {
  log.info(
    `The item at '${itemPath}' transitioned to a new SYNCHRONIZED condition of '${status}'. The reason for the change is '${reason}' with the message: '${message}'.`,
  );

  const k8sItem: any = await getItemByItemPath(itemPath);

  if (!('status' in k8sItem)) k8sItem.status = {};

  if (!('conditions' in k8sItem.status)) k8sItem.status.conditions = [];

  let conditionObject: any = getRelevantCondition(
    k8sItem.status.conditions,
    'SYNCHRONIZED',
  );

  conditionObject = {
    ...conditionObject,
    reason,
    status,
    message,
    observedGeneration: k8sItem.metadata.generation,
    lastSyncTime,
    lastUpdateTime: new Date().toJSON(),
    nextSyncTime,
  };

  k8sItem.status.conditions = updateConditionByType(
    k8sItem.status.conditions,
    'SYNCHRONIZED',
    conditionObject,
  );

  const itemParameters: Array<string> = itemPath.split('/');

  await writePrioritizedStatus(itemParameters[1], itemParameters[0], k8sItem);
}

export async function updateRetryStatusInCR(
  pluralKind: string,
  namespace: string,
  name: string,
  retryCount: number,
  nextRetryTime?: string,
) {
  const itemPath = `${namespace}/${pluralKind}/${name}`;

  try {
    const item: any = await getItemByItemPath(itemPath);

    if (!('status' in item) || item.status === null) item.status = {};

    item.status.retryCount = retryCount;

    if (nextRetryTime) {
      item.status.nextRetryTime = nextRetryTime;
    } else {
      delete item.status.nextRetryTime;
    }

    await writePrioritizedStatus(pluralKind, namespace, item);
  } catch (e: unknown) {
    if (isKubernetesNotFoundError(e)) {
      log.info(
        `Skipping retry status update for '${itemPath}' because the custom resource was not found.`,
      );
      return;
    }

    throw e;
  }
}

export function isKubernetesNotFoundError(error: unknown) {
  if (typeof error === 'string') {
    return isNotFoundMessage(error);
  }

  if (!error || typeof error !== 'object') {
    return false;
  }

  const k8sError = error as {
    body?: string;
    code?: number;
    message?: string;
    status?: number;
    statusCode?: number;
  };

  // Inspect possible status/code locations. Keep each candidate unique to
  // make the intent clear and avoid accidentally repeating the same field.
  const statusCandidates = [
    (k8sError as any).code,
    (k8sError as any).status,
    (k8sError as any).statusCode,
    (k8sError as any).response?.status,
    (k8sError as any).response?.statusCode,
    // Some HTTP clients populate a parsed body with a numeric `code` field.
    (k8sError as any).response?.body?.code,
  ];

  if (statusCandidates.some((c) => c === 404 || c === '404')) {
    return true;
  }

  // Inspect structured bodies that some clients set
  const reason =
    (k8sError as any).reason || (k8sError as any).response?.body?.reason;
  if (reason === 'NotFound' || reason === 'notFound') return true;

  // body may be a JSON string, or an object with message
  // Prefer parsing JSON body first (some clients put structured info there even when
  // error.message exists). Be defensive about parsing failures.
  if (typeof (k8sError as any).body === 'string') {
    try {
      const parsed = JSON.parse((k8sError as any).body);
      if (parsed?.code === 404) {
        return true;
      }

      if (parsed?.reason === 'NotFound' || parsed?.reason === 'notFound') {
        return true;
      }

      if (
        typeof parsed?.message === 'string' &&
        isNotFoundMessage(parsed.message)
      ) {
        return true;
      }
    } catch {
      // invalid JSON — fallthrough to message checks
    }
  }

  // If body is already an object with message/reason, inspect it
  if (typeof (k8sError as any).body?.message === 'string') {
    if (isNotFoundMessage((k8sError as any).body.message)) return true;
  }

  // Finally check top-level message
  if (
    typeof (k8sError as any).message === 'string' &&
    isNotFoundMessage((k8sError as any).message)
  ) {
    return true;
  }

  return false;
}

function isNotFoundMessage(message?: string) {
  return typeof message === 'string' && /\bnot\s*found\b/i.test(message);
}

export async function writePrioritizedStatus(
  kind: string,
  namespace: string,
  item: any,
) {
  setHighPriorityStatus(item);

  await writeStatus(kind, namespace, item);
}

export async function updateTransition(
  itemPath: string,
  reason: string,
  type: string,
  statusValue: string,
  message = '',
  updateStatusOnly = false,
) {
  log.info(
    `The item at '${itemPath}' transitioned to a new status of '${statusValue}' (type: '${type}'). The reason for the change is '${reason}' with the message: '${message}'. This was a status-only update: '${updateStatusOnly}'.`,
  );

  const k8sItem: any = await getItemByItemPath(itemPath);

  if (!('status' in k8sItem)) k8sItem.status = {};

  if (!('conditions' in k8sItem.status)) k8sItem.status.conditions = [];

  let conditionObject: any = getRelevantCondition(
    k8sItem.status.conditions,
    type,
  );

  if (updateStatusOnly) {
    conditionObject.status = statusValue;
  } else {
    conditionObject = updateCondition(
      conditionObject,
      reason,
      statusValue,
      message,
      k8sItem.metadata.generation,
    );
  }

  k8sItem.status.conditions = updateConditionByType(
    k8sItem.status.conditions,
    type,
    conditionObject,
  );

  const itemParameters: Array<string> = itemPath.split('/');

  await writePrioritizedStatus(itemParameters[1], itemParameters[0], k8sItem);
}

function getRelevantCondition(conditionList: Array<any>, type: string) {
  const condition = getConditionByType(conditionList, type);

  if (condition) return condition;

  return {
    lastTransitionTime: new Date().toJSON(),
    lastUpdateTime: new Date().toJSON(),
    message: '',
    observedGeneration: -1,
    reason: '',
    status: '',
    type: type,
  };
}

function updateCondition(
  condition: any,
  reason: string,
  status: string,
  message: string,
  generation: number,
) {
  condition.lastUpdateTime = new Date().toJSON();

  condition.message = message;

  condition.observedGeneration = generation;

  condition.reason = reason;

  condition.status = status;

  return condition;
}

export function getConditionByType(conditionList: Array<any>, type: string) {
  for (let i = 0; i < conditionList.length; i++) {
    if (conditionList[i].type === type) return conditionList[i];
  }

  return false;
}

function updateConditionByType(
  conditionList: Array<any>,
  type: string,
  newCondition: any,
) {
  let typeFound = false;

  for (let i = 0; i < conditionList.length; i++) {
    if (conditionList[i].type === type) {
      conditionList[i] = newCondition;

      typeFound = true;
    }
  }

  if (!typeFound) conditionList.push(newCondition);

  return conditionList;
}
