import { OperationType } from '../informer';
import { tryPublishError } from '../user-feedback-ops/user-feedback-ops';
import common from 'catalog_common';

export function policyAllowsOp(policy: string, op: OperationType, item: any) {
  let msg = '';

  const foundPolicy = common.policies.getPolicyByName(policy);

  if (
    op === OperationType.RETRY.toString() &&
    foundPolicy?.allowedOps.includes(op)
  ) {
    if ('deletionTimestamp' in item.metadata && 'full-control' !== policy) {
      msg = `A RETRY operation is not allowed on a resource with a deletionTimestamp. It means
that the resource is being deleted and it is not possible to retry the operation with policy: ${policy}.

To fix this issue, you must first delete the "firestartr.dev/finalizer" from finalizers array in the resource manifest,
it will be automatically deleted by Kubernetes. Terraform will not execute any operation on the resource.
`;
      return { allowed: false, msg };
    } else {
      return { allowed: true, msg };
    }
  }

  if (
    op === OperationType.RETRY_SYNC.toString() &&
    foundPolicy?.allowedOps.includes(OperationType.SYNC.toString())
  ) {
    if ('deletionTimestamp' in item.metadata && 'full-control' !== policy) {
      msg = `A RETRY_SYNC operation is not allowed on a resource with a deletionTimestamp. It means
that the resource is being deleted and it is not possible to retry the operation with policy: ${policy}.

To fix this issue, you must first delete the "firestartr.dev/finalizer" from finalizers array in the resource manifest,
it will be automatically deleted by Kubernetes. Terraform will not execute any operation on the resource.
`;
      return { allowed: false, msg };
    }
    return { allowed: true, msg };
  }

  if (!foundPolicy) {
    msg = `Policy ${policy} not found`;

    return { allowed: false, msg };
  }

  const allowed = foundPolicy.allowedOps.includes(op);

  if (!allowed) {
    msg = searchAllowedPolicies(op, policy);
  }

  return { allowed, msg };
}

function searchAllowedPolicies(op: OperationType, policy: string) {
  const allowedPolicies = [];

  for (const policy of common.policies.FIRESTARTR_POLICIES) {
    if (policy.allowedOps.includes(op)) {
      allowedPolicies.push(policy.name);
    }
  }

  let policies = '';

  if (allowedPolicies.length > 0) {
    policies = allowedPolicies.join(', ');
  }

  return `
    
Operation ${op} not allowed by policy \`${policy}\`, to allow this operation,

switch to one of the following policies: \`${policies}\`

`;
}

export async function* errorPolicyCompatibility(
  syncPolicy: string,
  generalPolicy: string,
  item: any,
  op: OperationType,
) {
  const message = `Conflict: 'sync-policy': ${syncPolicy} and 'policy': ${generalPolicy} are not compatible`;

  for (const typeStatus of [
    ['ERROR', 'True'],
    ['PROVISIONED', 'False'],
    ['PROVISIONING', 'False'],
    ['OUT_OF_SYNC', 'False'],
    ['DELETED', 'False'],
    ['PLANNING', 'False'],
    ['DELETING', 'False'],
  ]) {
    const [type, status] = typeStatus;

    yield {
      item,
      reason: op,
      type,
      status,
      message,
    };
  }

  await tryPublishError(item, op, message);
}
