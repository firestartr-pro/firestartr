import { setHeaderOptions } from '@kubernetes/client-node';

export const CRD_KIND = 'CustomResourceDefinition';

// In @kubernetes/client-node 1.x the per-request `{ headers }` option no
// longer exists and is silently ignored. Patch content types must be set
// through call-time header middleware (`setHeaderOptions`), which the
// generated clients merge via `mergeConfiguration(this.configuration,
// options)`.
export const MERGE_PATCH_HEADERS = setHeaderOptions(
  'Content-Type',
  'application/merge-patch+json',
);

export const CLEAR_FINALIZERS_PATCH = {
  op: 'replace',
  path: '/metadata/finalizers',
  value: [] as string[],
};

export const JSON_PATCH_HEADERS = setHeaderOptions(
  'Content-Type',
  'application/json-patch+json',
);

export const STRATEGIC_MERGE_PATCH_HEADERS = setHeaderOptions(
  'Content-Type',
  'application/strategic-merge-patch+json',
);
