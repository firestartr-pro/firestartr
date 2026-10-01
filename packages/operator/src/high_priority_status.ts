import log from './logger';

const SORTED_PRIORITIES = [
  'ERROR',
  'PROVISIONING',
  'OUT_OF_SYNC',
  'PLANNING',
  'DELETING',
  'SYNCHRONIZED',
  'PROVISIONED',
  'DELETED',
];

export function setHighPriorityStatus(item: any) {
  const highPriorityCondition = conditionsSorter(item.status?.conditions || []);

  let highPriorityState = null;

  if (highPriorityCondition) {
    highPriorityState = {
      type: highPriorityCondition.type,
      reason: highPriorityCondition.reason,
    };
  } else {
    highPriorityState = {
      type: 'UNKNOWN',
      reason: 'AwaitingReconciliation',
    };
  }

  item.status.highPriorityState = highPriorityState.type;
  item.status.highPriorityReason = highPriorityState.reason;

  log.silly(
    `${item.kind}/${item.metadata.name} - Set HighPriorityStatus to ${item.status.highPriorityState} - ${item.status.highPriorityReason}`,
  );
}

function conditionsSorter(conditions: any) {
  if (conditions.length === 0) return null;

  const getPriority = (type: string) => {
    const index = SORTED_PRIORITIES.indexOf(type);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };

  return conditions
    .filter((condition: any) => {
      return condition.status === 'True';
    })
    .sort((a: any, b: any) => {
      const priorityA = getPriority(a.type);
      const priorityB = getPriority(b.type);

      return priorityA - priorityB;
    })[0];
}
