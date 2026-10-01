import { resolveScalar, resolveClaimSecret } from './resolver';
import { walk } from './walker';

export { getRefNameFromKey, resolveRef, resolveScalar } from './resolver';

export function resolveValues(values: any, refs: any) {
  return walk(values, (value: any) => resolveScalar(value, refs));
}

export function resolveClaimSecrets(values: any, refs: any) {
  return walk(values, (value: any) => resolveClaimSecret(value, refs));
}
