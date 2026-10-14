import type { Dependencies } from './resolver';

// ----------------------------------------------------
// Kinds and plural-kinds definitions
// ----------------------------------------------------

const kindPluralMap: any = {
  githubgroups: 'FirestartrGithubGroup',
  githubmemberships: 'FirestartrGithubMembership',
  githubrepositories: 'FirestartrGithubRepository',
  githubrepositoryfeatures: 'FirestartrGithubRepositoryFeature',
  githubrepositorysecretssections: 'FirestartrGithubRepositorySecretsSection',
  terraformmodules: 'FirestartrTerraformModule',
  githuborgwebhooks: 'FirestartrGithubOrgWebhook',
  githuborganizationsettings: 'FirestartrGithubOrganizationSettings',
  githuborganizationvariablesections:
    'FirestartrGithubOrganizationVariableSection',
  terraformworkspaces: 'FirestartrTerraformWorkspace',
  providerconfigs: 'FirestartrProviderConfig',
  externalsecrets: 'ExternalSecret',
  secrets: 'Secret',
  fsdummiesa: 'FirestartrDummyA',
  fsdummiesb: 'FirestartrDummyB',
  fsdummiesc: 'FirestartrDummyC',
};

export function getKindFromPlural(plural: string) {
  return kindPluralMap[plural];
}

export function getPluralFromKind(kind: string) {
  const plural = Object.keys(kindPluralMap).find(
    (key) => kindPluralMap[key] === kind,
  );

  return plural;
}

// ----------------------------------------------------
// Operations, workitems and handlers definitions
// ----------------------------------------------------

/**
 * Helper to extract the canonical identity (metadata.uid) from a WorkItem or its item.
 *
 * Use this helper when you need a stable identity key for WorkItems, e.g. for
 * in-memory deferred-scheduling bookkeeping.
 *
 * Note: other subsystems may still use kind/namespace/name keys; this helper is
 * specifically intended for UID-based WorkItem identity.
 * Any future change to identity logic MUST be made here and nowhere else.
 *
 * Returns undefined if .metadata.uid is missing so scheduler/bookkeeping paths
 * can safely short-circuit instead of throwing and aborting an entire pass.
 */
export function getWorkItemIdentity(wi: WorkItem): string | undefined {
  // Support either .item.metadata.uid or direct .metadata.uid for future extensibility
  const meta =
    wi.item && wi.item.metadata ? wi.item.metadata : (wi as any).metadata;
  return meta && meta.uid ? meta.uid : undefined;
}

export enum OperationType {
  RENAMED = 'RENAMED',
  UPDATED = 'UPDATED',
  CREATED = 'CREATED',
  SYNC = 'SYNC',
  MARKED_TO_DELETION = 'MARKED_TO_DELETION',
  NOTHING = 'NOTHING',
  RETRY = 'RETRY',
  RETRY_SYNC = 'RETRY_SYNC',
}

export function retryOpForReason(reason: string | undefined): OperationType {
  if (!reason) return OperationType.RETRY;
  const base = reason.startsWith('RETRY_') ? reason.slice(6) : reason;
  switch (base) {
    case 'SYNC':
      return OperationType.RETRY_SYNC;
    default:
      return OperationType.RETRY;
  }
}

export enum WorkStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  FINISHED = 'FINISHED',
}

export type WorkItem = {
  item: any;

  getItem?: Function;

  operation: OperationType;

  handler?: WorkItemHandler;

  workStatus: WorkStatus;

  onDelete: Function;

  process?: Function;

  upsertTime?: number;

  isDeadLetter?: boolean;

  // flag to control if the operation ( normally a MARKED_TO_DELETION )
  // is blocked by an external condition
  isBlocked?: boolean;

  // function to unblock this workitem ( clearing the timeout )
  // normally it happens naturally ( with the unblock of the operation )
  // but it can be forcefully
  fUnblock?: Function;

  // id of the slot running the workitem, useful for debugging and for blocking/unblocking the workitem
  slotId?: number;

  // flag to control if the workItem has been picked
  isPicked?: boolean;
};

type HandlerFinalizerFn = (
  kind: string,
  namespace: string,
  item: any | string,
  finalizer: string,
) => Promise<any>;

type HandlerInformPlanFn = (prUrl: string, planText: string) => Promise<void>;

type WriteTerraformOutputInTfResultFn = (
  item: any,
  output: string,
  exitCode?: number,
) => Promise<any>;

type WriteConnectionSecretFn = (
  item: any,
  outputsConnection: any,
  finalize?: boolean,
) => Promise<void>;

type ResolveReferencesFn = () => Promise<Dependencies>;

type DeleteSecretFn = () => Promise<null | undefined>;

type ItemPathFn = () => string;

type ErrorFn = () => Promise<void>;

type SuccessFn = () => Promise<void>;

export type WorkItemHandler = {
  finalize: HandlerFinalizerFn;

  pluralKind: string;

  informPlan: HandlerInformPlanFn;

  writeTerraformOutputInTfResult: WriteTerraformOutputInTfResultFn;

  writeConnectionSecret: WriteConnectionSecretFn;

  resolveReferences: ResolveReferencesFn;

  resolveOwnOutputs: () => Promise<any | undefined>;

  deleteSecret: DeleteSecretFn;

  itemPath: ItemPathFn;

  error: ErrorFn;

  success: SuccessFn;

  removeFromRetry?: () => void;

  isBlocked?: boolean;

  isPicked?: boolean;

  needsBlocking?: (item: any, operation: OperationType) => boolean;

  fUnblock?: Function;

  recommendedTimeout: () => number;

  getSlotInfo?: () => any;
};

// ----------------------------------------------------
// Timeouts for operations, expressed in seconds
// ----------------------------------------------------
const DAY_SECONDS = 24 * 60 * 60;
const TIMEOUTS = {
  // expressed in seconds
  RENAMED: DAY_SECONDS,

  UPDATED: DAY_SECONDS,

  CREATED: DAY_SECONDS,

  RETRY: 120 * 60, // Keep retry operations with a 7200s (2h) timeout

  RETRY_SYNC: 120 * 60,

  MARKED_TO_DELETION: DAY_SECONDS,

  SYNC: DAY_SECONDS,

  NOTHING: 10,
};

export function getTimeoutForOperation(operation: string) {
  if (operation in TIMEOUTS) {
    return TIMEOUTS[operation];
  } else {
    throw new Error(`getTimeoutForOperation: Unknown operation: ${operation}`);
  }
}
