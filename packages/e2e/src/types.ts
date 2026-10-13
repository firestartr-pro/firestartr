import type { JsonPatchOperation } from 'render/src/utils/auxiliar';
import type { K8sResource } from './k8s/types';
import type { TFResult } from './k8s/tfresult';

// Re-export shared render helper types from one e2e entrypoint.
export type {
  JsonPatchOperation,
  JsonValue,
  TestContext,
} from 'render/src/utils/auxiliar';

// Initialization options for creating the e2e client.
export interface E2EInitOptions {
  // Optional kubeconfig file path override.
  // Example: '/Users/me/.kube/config'.
  kubeconfig?: string;

  // Optional kubeconfig context override.
  // Values come from `kubectl config get-contexts -o name`.
  // Example: 'kind-firestartr-e2e'.
  kubeconfigContext?: string;

  // Prefix used to build claim/resource names as '<prefix>-e2e-<fixture>'.
  // Example: 'org-script-render-apply'.
  namePrefix?: string;

  // Optional base fixtures path for claims config folders.
  // Expected subfolders: 'base_claims', 'initializers', and 'globals'.
  // Example: 'packages/e2e/fixtures'.
  fixturesBasePath?: string;

  // Optional fixture stem subset loaded into the render context.
  // Values are file names without extension from
  // `packages/e2e/fixtures/base_claims` (recursive).
  // Example: ['firestartr', 'component_a'].
  // Hyphenated names are normalized (for example 'component-a' -> 'component_a').
  onlyFiles?: string[];
}

// Local render customization applied before CR lookup.
export interface RenderLocallyOptions {
  // Optional fixture source when rendering the same base fixture with many
  // different claim names. Defaults to the first renderLocally argument.
  sourceFixtureName?: string;

  // Optional exact claim name for the duplicated fixture. Defaults to the
  // generated '<prefix>-e2e-<name>' convention.
  claimName?: string;

  // Deep-merged into the claim YAML before patch operations run.
  // Example: { providers: { github: { branchStrategy: { name: 'none' } } } }.
  merge?: Record<string, unknown>;

  // JSON patch operations appended after common claim patches.
  // Example: [{ op: 'replace', path: '/members', value: [] }].
  // Patch format follows `JsonPatchOperation` from fast-json-patch.
  patches?: JsonPatchOperation[];
}

// Result returned by `claims.renderLocally(...)`.
export interface RenderLocallyResult {
  // Every rendered CR path that matches this claim reference.
  // Example for component claims: repository + feature + secrets-section CRs.
  // This list is guaranteed non-empty (renderLocally throws when no match exists).
  // Choose a primary CR explicitly when needed (for example `const primary = crPaths[0]`).
  // This keeps primary-resource selection explicit in each test flow.
  crPaths: string[];

  // Temporary output directory containing all rendered files.
  outputPath: string;
}

// Minimal artifact info tracked for cleanup.
// `crPath` is one rendered CR file path stored per rendered artifact.
export type RenderedArtifact = {
  crPath: string;
  outputPath: string;
};

// Claims API surface used by e2e tests.
// "Context" is the temporary render workspace created by
// `createTestContext(...)` in `packages/e2e/src/test-context.ts`.
// It contains copied fixture claim files, applied patches, and output folders.
export interface ClaimsApi {
  // Recreate the current context from original source fixtures.
  // Useful to discard previous file patches while keeping the same fixture set.
  restartContext: () => Promise<void>;

  // Destroy temp context directories and clear render caches/artifact tracking.
  destroyContext: () => Promise<void>;

  // Update prefix used for future generated claim names.
  // Example: setPrefix('my-suite') -> claim names like 'my-suite-e2e-group-a'.
  setPrefix: (prefix: string) => void;

  // Ensure context exists and patch a fixture file in place.
  // `fixtureName` uses fixture stem names from
  // `packages/e2e/fixtures/base_claims` (recursive, no extension).
  // Example:
  // patchContextFile('firestartr', [
  //   { op: 'add', path: '/providers/github/tfStateKey', value: 'abc' },
  // ]).
  patchContextFile: (
    fixtureName: string,
    patches: JsonPatchOperation[],
  ) => Promise<void>;

  // Render a fixture locally and return matching rendered CR metadata.
  // `name` is a fixture identifier (example: 'group-a' or 'component-a').
  renderLocally: (
    name: string,
    options?: RenderLocallyOptions,
  ) => Promise<RenderLocallyResult>;

  // Snapshot of the artifacts produced by renderLocally calls so far.
  // Mutating the returned array or its artifacts does not affect cleanup behaviour.
  getRenderArtifacts: () => RenderedArtifact[];

  // Fixtures root for this session, defaulted to the repo fixtures directory.
  // Throws when no init override is set and the repo fixtures directory
  // cannot be resolved.
  getFixturesBasePath: () => string;
}

// Shared base for bulk custom-resource deletion options.
type DeleteByOptions = {
  // Target CRD kind (for example `CLAIM_KIND_TO_CR_KIND['GroupClaim']`).
  kind: string;
  // Target CRD apiVersion (for example `FIRESTARTR_API_VERSION`).
  apiVersion: string;
  // Delete timeout in seconds. Defaults to 300.
  timeout?: number;
  // Clear finalizers before waiting for deletion to avoid stuck resources.
  forceFinalizers?: boolean;
};

// Options object for deleteCustomResourcesByLabel.
export type DeleteByLabelOptions = DeleteByOptions & {
  // Kubernetes label selector string.
  labelSelector: string;
};

// Options object for listCustomResourcesByAnnotation.
export type ListByAnnotationOptions = {
  // Custom resource kind to list.
  kind: string;
  // Custom resource apiVersion (must be a custom resource).
  apiVersion: string;
  // Annotation key to match (for example the claim-ref annotation).
  annotationKey: string;
  // Allowed annotation values; resources whose annotation value is in this
  // list are returned.
  annotationValues: string[];
};

// Options object for deleteCustomResourcesByAnnotation.
export type DeleteByAnnotationOptions = DeleteByOptions & {
  // Annotation key to match (for example the claim-ref annotation).
  annotationKey: string;
  // Allowed annotation values; resources whose annotation value is in this
  // list are deleted.
  annotationValues: string[];
};

// Kubernetes API surface used by e2e tests.
export interface K8sApi {
  // Set default namespace for namespaced operations.
  // Example: 'default'.
  setNamespace: (namespace: string) => void;

  // Read current default namespace.
  getNamespace: () => string;

  // Apply a manifest path (usually chosen from `RenderLocallyResult.crPaths`).
  // Example: applyCr(rendered.crPaths[0]).
  applyCr: (crPath: string) => Promise<void>;

  // Apply Firestartr CRDs by released version.
  // Example: 'v1.208.0' (often from `E2E_CRD_UPGRADE_BASELINE_VERSION`).
  applyCrds: (version: string) => Promise<void>;

  // Apply Firestartr CRDs from the current branch checkout.
  applyInBranchCrds: () => Promise<void>;

  // Delete namespaced custom resources that match a Kubernetes label selector.
  // Example: labelSelector 'app.kubernetes.io/name=my-claim'.
  deleteCustomResourcesByLabel: (
    options: DeleteByLabelOptions,
  ) => Promise<number>;

  // Delete namespaced custom resources by annotation value matching.
  // Example: annotationKey 'firestartr.dev/claim-ref',
  // annotationValues ['GroupClaim/firestartr'].
  deleteCustomResourcesByAnnotation: (
    options: DeleteByAnnotationOptions,
  ) => Promise<number>;

  // List namespaced custom resources whose annotation value matches.
  // Example: annotationKey 'firestartr.dev/claim-ref',
  // annotationValues ['GroupClaim/firestartr'].
  listCustomResourcesByAnnotation: (
    options: ListByAnnotationOptions,
  ) => Promise<K8sResource[]>;

  // Wait for the resource in `crPath` to reach `status`.
  // `status` defaults to 'PROVISIONED'.
  waitForCr: (
    crPath: string,
    timeout?: number,
    status?: string,
  ) => Promise<K8sResource>;

  // Delete the resource in `crPath` and wait until it is removed.
  deleteCr: (crPath: string, timeout?: number) => Promise<void>;

  // Remove one metadata annotation from the resource in `crPath`.
  removeCrAnnotation: (crPath: string, annotationKey: string) => Promise<void>;

  // Look up tfStateKey for a Group claim name.
  // Example claim name: 'firestartr' -> matches annotation 'GroupClaim/firestartr'.
  // Returns undefined when no matching CR exists in the namespace.
  getGroupTfStateKey: (claimName: string) => Promise<string | undefined>;

  // Find TFResult resource by reference (refKind and refName).
  // Example: refKind 'GroupClaim', refName 'firestartr'.
  // Returns the matching TFResult resource or undefined if not found.
  findTFResultByReference: (
    refKind: string,
    refName: string,
  ) => Promise<TFResult | undefined>;
}

// GitHub API surface used by e2e tests.
export interface GhApi {
  // Check if a repository exists in current org.
  // Example repo names: 'claims', 'state-github', 'state-infra'.
  repoExists: (name: string) => Promise<boolean>;

  // Read repository metadata in current org that e2e assertions commonly use.
  getRepoInfo: (name: string) => Promise<{
    description: string | null;
    topics: string[];
  }>;

  // Read repository Actions secret metadata in current org.
  getRepoSecret: (
    repoName: string,
    secretName: string,
  ) => Promise<{
    name: string;
    updatedAt: string;
  }>;

  // Check if a team/group slug exists in current org.
  // Example: 'platform-team'.
  groupExists: (name: string) => Promise<boolean>;

  // List all repository names in current org.
  listRepos: () => Promise<string[]>;

  // List all group/team names in current org.
  listGroups: () => Promise<string[]>;

  // List all organization webhooks in current org.
  listOrgWebhooks: () => Promise<GhOrgWebhook[]>;

  // Find a single organization webhook by its delivery URL.
  findOrgWebhookByUrl: (url: string) => Promise<GhOrgWebhook | null>;

  // Check if an organization webhook exists by delivery URL.
  orgWebhookExists: (url: string) => Promise<boolean>;

  // Read the current organization settings for the current org.
  getOrgSettings: () => Promise<GhOrgSettings>;

  // Delete repository by name in current org.
  destroyRepo: (name: string) => Promise<void>;

  // Delete team/group by slug in current org.
  destroyGroup: (name: string) => Promise<void>;

  // Delete an organization webhook by delivery URL in current org.
  destroyOrgWebhookByUrl: (url: string) => Promise<void>;

  // List GitHub Actions organization variables in current org.
  listOrgVariables: () => Promise<GhOrgVariable[]>;

  // Find a single organization variable by name in current org.
  findOrgVariableByName: (name: string) => Promise<GhOrgVariable | null>;

  // Check if an organization variable exists by name in current org.
  orgVariableExists: (name: string) => Promise<boolean>;

  // Create a GitHub Actions organization variable in current org.
  createOrgVariable: (
    name: string,
    value: string,
    visibility: 'all' | 'private' | 'selected',
    selectedRepositoryIds?: number[],
  ) => Promise<void>;

  // Delete a GitHub Actions organization variable by name in current org.
  deleteOrgVariable: (name: string) => Promise<void>;

  // List selected repository names (org/repo) for an organization variable.
  getOrgVariableSelectedRepositories: (name: string) => Promise<string[]>;

  // Read primary GitHub rate-limit state for the current installation token.
  getRateLimit: () => Promise<GhRateLimit>;

  // Read file content from a repository in current org.
  // Retries on not-found only when retryOptions.attempts is greater than 1.
  // Throws when the file is not found after all retry attempts.
  getRepoFile: (
    repoName: string,
    filePath: string,
    retryOptions?: { attempts?: number; delayMs?: number },
  ) => Promise<string>;

  // Read file content from a repository in current org, returning null when absent.
  tryGetRepoFile: (
    repoName: string,
    filePath: string,
  ) => Promise<string | null>;

  // Read all repo labels for a repository in current org.
  // Returns an array of { name, color, description }.
  getRepoLabels: (repoName: string) => Promise<GhRepoLabel[]>;

  // Create a repo label on a repository in current org.
  createRepoLabel: (
    repoName: string,
    label: { name: string; color: string; description?: string },
  ) => Promise<void>;
}

export interface GhRateLimit {
  core: {
    limit: number;
    remaining: number;
    reset: number;
  };
}

export interface GhOrgWebhook {
  id: number;
  deliveryUrl: string;
  active: boolean;
  events: string[];
  name?: string;
}

// Subset of GitHub Actions organization variable metadata that e2e assertions
// read back. Values are never returned by the GitHub API.
export interface GhOrgVariable {
  name: string;
  visibility: 'all' | 'private' | 'selected';
  selectedRepositories?: string[];
}

// Subset of GitHub organization settings that e2e assertions read back.
export interface GhOrgSettings {
  description: string | null;
  company: string | null;
  hasOrganizationProjects: boolean | null;
}

export interface GhRepoLabel {
  name: string;
  color: string;
  description: string;
}

// Top-level e2e client composed of claims, Kubernetes, and GitHub helpers.
export interface E2EApi {
  // Read current generated-name prefix.
  getPrefix: () => string;

  // Update generated-name prefix.
  setPrefix: (prefix: string) => void;

  // Read active GitHub org for this client.
  getOrg: () => string;

  // Update active GitHub org for this client.
  setOrg: (org: string) => void;

  claims: ClaimsApi;

  k8s: K8sApi;

  gh: GhApi;
}
