import type { ArtifactAction, ArtifactRecord } from './types';

const FIRESTARTR_API_VERSION = 'firestartr.dev/v1';

export function createArtifactRecord(
  kind: string,
  name: string,
  namespace: string,
  action: ArtifactAction,
  claimRef?: string,
): ArtifactRecord {
  return {
    kind,
    name,
    namespace,
    action,
    timestamp: new Date().toISOString(),
    crdApiVersion: FIRESTARTR_API_VERSION,
    ...(claimRef !== undefined ? { claimRef } : undefined),
  };
}

export function resolveOperatorNamespace(): string {
  return process.env['E2E_OPERATOR_NAMESPACE'] ?? 'default';
}
