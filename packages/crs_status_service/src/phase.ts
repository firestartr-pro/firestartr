// Phase-priority order — keep in sync with
// packages/operator/src/high_priority_status.ts
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

export function derivePhase(
  conditions: { type: string; status: string }[],
): string {
  const getPriority = (type: string): number => {
    const index = SORTED_PRIORITIES.indexOf(type);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };

  const highest = conditions
    .filter((c) => c.status === 'True')
    .sort((a, b) => getPriority(a.type) - getPriority(b.type))[0];

  return highest?.type ?? 'UNKNOWN';
}
