import type * as k8s from '@kubernetes/client-node';

// Cluster-scoped kinds that should not be treated as namespaced resources.
export const CLUSTER_SCOPED_KINDS = new Set([
  'Namespace',
  'CustomResourceDefinition',
  'ClusterRole',
  'ClusterRoleBinding',
  'PersistentVolume',
  'StorageClass',
  'ValidatingWebhookConfiguration',
  'MutatingWebhookConfiguration',
  'APIService',
  'Node',
  'PriorityClass',
  'RuntimeClass',
  'VolumeAttachment',
  'CSINode',
  'CSIDriver',
  'CertificateSigningRequest',
  'PodSecurityPolicy',
]);

// Cluster-scoped kinds explicitly allowed in e2e helpers.
const ALLOWED_CLUSTER_SCOPED_KINDS = new Set(['CustomResourceDefinition']);

// True when the kind is known to be cluster scoped.
export function isClusterScopedKind(kind: string): boolean {
  return Boolean(kind) && CLUSTER_SCOPED_KINDS.has(kind);
}

// True when the cluster-scoped kind is allowed by current safeguards.
export function isAllowedClusterScopedKind(kind: string): boolean {
  return ALLOWED_CLUSTER_SCOPED_KINDS.has(kind);
}

// Guard against accidentally running namespaced operations on unsafe kinds.
export function assertNamespacedKind(kind: string): void {
  if (!kind) return;
  if (isClusterScopedKind(kind) && !isAllowedClusterScopedKind(kind)) {
    throw new Error(`Cluster-scoped resources are not supported: ${kind}`);
  }
}

// Polling options for read/wait helper operations.
export interface WaitForOptions {
  // Namespace override for namespaced resources.
  namespace?: string;

  // API version override used for dynamic lookups.
  apiVersion?: string;

  // Poll interval in milliseconds while waiting.
  pollIntervalMs?: number;
}

// Delete behavior options for Kubernetes manifests/resources.
export interface DeleteOptions {
  // Namespace override for namespaced resources.
  namespace?: string;

  // Force deletion mode when supported by API helper.
  force?: boolean;

  // Ignore 404/not-found responses.
  ignoreNotFound?: boolean;

  // Timeout in seconds to wait for deletion to complete after force-removing finalizers.
  // Only applies to custom resources (CRs); standard/built-in resource force-deletion
  // does not include a wait phase and ignores this option. Default: 300.
  timeoutSeconds?: number;
}

// Minimal dynamic Kubernetes resource shape used by e2e helpers.
export interface K8sResource {
  apiVersion: string;

  kind: string;

  metadata?: {
    name?: string;
    namespace?: string;
    resourceVersion?: string;
    generation?: number;
    finalizers?: string[];
    annotations?: Record<string, string>;
  };

  status?: {
    state?: string;
    phase?: string;
    status?: string;
    conditions?: Array<{
      type: string;
      status: string | boolean;
      reason?: string;
      message?: string;
      lastUpdateTime?: string;
      lastTransitionTime?: string;
      observedGeneration?: number;
    }>;
  };

  spec?: unknown;
}

// Kubernetes List wrapper used when querying dynamic resources.
export interface K8sListResource {
  apiVersion: string;

  kind: 'List';

  items: K8sResource[];
}

// Minimal CRD lookup metadata required for dynamic APIs.
export interface CrdInfo {
  plural: string;

  namespaced: boolean;
}

// File-based kubeconfig source descriptor.
export interface KubeconfigSource {
  path: string;
}

// Factory returning a ready-to-use Kubernetes client-node KubeConfig.
export type KubeConfigProvider = () => k8s.KubeConfig;

// Lightweight error shape used across Kubernetes utility layers.
export interface K8sApiError {
  code?: number;
  statusCode?: number;

  body?: unknown;

  message?: string;
}

// K8s client contract used by the higher-level e2e API.
export interface K8sClient {
  // Apply manifest file to the cluster.
  apply: (inputPath: string, namespace?: string) => Promise<void>;

  // Delete manifest file resource from the cluster.
  delete: (inputPath: string, options?: DeleteOptions) => Promise<void>;

  // Wait for resource status to match expected value.
  waitFor: (
    kind: string,
    name: string,
    status: string,
    timeoutMs: number,
    options?: WaitForOptions,
  ) => Promise<K8sResource>;
}
