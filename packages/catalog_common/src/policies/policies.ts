import log from '../logger';

type Policy = {
  name: string;

  weight: number;

  aliases: string[];

  allowedOps: string[];
};

export const FIRESTARTR_POLICIES: Policy[] = [
  {
    name: 'full-control',
    weight: 10,
    aliases: [],
    allowedOps: [
      'UPDATED',
      'CREATED',
      'RENAMED',
      'SYNC',
      'MARKED_TO_DELETION',
      'RETRY',
      'NOTHING',
    ],
  },

  {
    name: 'apply',
    weight: 9,
    aliases: ['create-update-only'],
    allowedOps: ['UPDATED', 'CREATED', 'RENAMED', 'SYNC', 'RETRY', 'NOTHING'],
  },

  {
    name: 'observe',
    weight: 8,
    aliases: ['observe-only'],
    allowedOps: ['SYNC'],
  },

  {
    name: 'create-only',
    weight: 8,
    aliases: [],
    allowedOps: ['CREATED', 'RETRY', 'SYNC'],
  },
];

export function getPolicyByName(policyName: string): Policy | undefined {
  return FIRESTARTR_POLICIES.find(
    (p) => p.name === policyName || p.aliases.includes(policyName),
  );
}

export function policiesAreCompatible(
  syncPolicy: string,
  generalPolicy: string,
): boolean {
  log.debug(
    'Validating policy compatibility: %s %s',
    syncPolicy,
    generalPolicy,
  );

  const syncPolicyWeight = getPolicyByName(syncPolicy)?.weight;

  const generalPolicyWeight = getPolicyByName(generalPolicy)?.weight;

  if (!syncPolicyWeight || !generalPolicyWeight) {
    throw new Error(`Policy ${syncPolicy} or ${generalPolicy} not found`);
  }

  if (generalPolicyWeight >= syncPolicyWeight) {
    log.debug('Policies %s %s are compatible', syncPolicy, generalPolicy);

    return true;
  }

  log.debug('Policies %s %s are not compatible', syncPolicy, generalPolicy);

  return false;
}
