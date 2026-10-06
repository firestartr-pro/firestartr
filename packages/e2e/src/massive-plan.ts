type MassiveEnv = Record<string, string | undefined>;

export interface MassiveConfig {
  repoCount: number;
  groupCount: number;
  groupBatchSize: number;
  repoBatchSize: number;
  deleteBatchSize: number;
  groupBatchPauseMs: number;
  repoBatchPauseMs: number;
  deleteBatchPauseMs: number;
  groupApplyStaggerMs: number;
  repoApplyStaggerMs: number;
  deleteStaggerMs: number;
  minCoreRateRemaining: number;
  rateResetCushionMs: number;
  disableSleepGuards: boolean;
}

type MassiveIntegerConfigKey = Exclude<
  keyof MassiveConfig,
  'disableSleepGuards'
>;

export interface MassiveGroupTemplate {
  claimName: string;
  providerName: string;
  displayName: string;
  description: string;
  fixtureName: 'group-a';
}

export interface MassiveRepositoryTemplate {
  claimName: string;
  providerName: string;
  ownerRef: string;
  description: string;
  topics: string[];
  features: Array<{ name: string; version: string }>;
  fixtureName: 'component-a';
}

export interface MassivePlan {
  groups: MassiveGroupTemplate[];
  repositories: MassiveRepositoryTemplate[];
  canary: {
    create: MassiveRepositoryTemplate;
    modified: MassiveRepositoryTemplate;
  };
}

const DEFAULT_CONFIG: MassiveConfig = {
  repoCount: 50,
  groupCount: 10,
  groupBatchSize: 2,
  repoBatchSize: 5,
  deleteBatchSize: 5,
  groupBatchPauseMs: 30000,
  repoBatchPauseMs: 60000,
  deleteBatchPauseMs: 60000,
  groupApplyStaggerMs: 10000,
  repoApplyStaggerMs: 15000,
  deleteStaggerMs: 10000,
  minCoreRateRemaining: 1000,
  rateResetCushionMs: 60000,
  disableSleepGuards: false,
};

const ENV_KEYS: Record<MassiveIntegerConfigKey, string> = {
  repoCount: 'E2E_MASSIVE_REPO_COUNT',
  groupCount: 'E2E_MASSIVE_GROUP_COUNT',
  groupBatchSize: 'E2E_MASSIVE_GROUP_BATCH_SIZE',
  repoBatchSize: 'E2E_MASSIVE_REPO_BATCH_SIZE',
  deleteBatchSize: 'E2E_MASSIVE_DELETE_BATCH_SIZE',
  groupBatchPauseMs: 'E2E_MASSIVE_GROUP_BATCH_PAUSE_MS',
  repoBatchPauseMs: 'E2E_MASSIVE_REPO_BATCH_PAUSE_MS',
  deleteBatchPauseMs: 'E2E_MASSIVE_DELETE_BATCH_PAUSE_MS',
  groupApplyStaggerMs: 'E2E_MASSIVE_GROUP_APPLY_STAGGER_MS',
  repoApplyStaggerMs: 'E2E_MASSIVE_REPO_APPLY_STAGGER_MS',
  deleteStaggerMs: 'E2E_MASSIVE_DELETE_STAGGER_MS',
  minCoreRateRemaining: 'E2E_MASSIVE_MIN_CORE_RATE_REMAINING',
  rateResetCushionMs: 'E2E_MASSIVE_RATE_RESET_CUSHION_MS',
};

const DISABLE_SLEEP_GUARDS_ENV_KEY = 'E2E_MASSIVE_DISABLE_SLEEP_GUARDS';

function parseIntegerEnv(
  env: MassiveEnv,
  key: string,
  defaultValue: number,
  allowZero: boolean,
): number {
  const rawValue = env[key]?.trim();
  if (!rawValue) return defaultValue;

  const value = Number(rawValue);
  const valid = Number.isInteger(value) && (allowZero ? value >= 0 : value > 0);
  if (!valid) {
    throw new Error(
      `${key} must be ${allowZero ? 'a non-negative' : 'a positive'} integer`,
    );
  }

  return value;
}

function parseBooleanFlagEnv(env: MassiveEnv, key: string): boolean {
  const rawValue = env[key]?.trim().toLowerCase();
  if (!rawValue || rawValue === 'false' || rawValue === '0') return false;
  if (rawValue === 'true' || rawValue === '1') return true;

  throw new Error(`${key} must be a boolean flag (true/false/1/0)`);
}

function padded(index: number): string {
  return String(index).padStart(3, '0');
}

export function parseMassiveConfig(
  env: MassiveEnv = process.env,
): MassiveConfig {
  return {
    repoCount: parseIntegerEnv(
      env,
      ENV_KEYS.repoCount,
      DEFAULT_CONFIG.repoCount,
      false,
    ),
    groupCount: parseIntegerEnv(
      env,
      ENV_KEYS.groupCount,
      DEFAULT_CONFIG.groupCount,
      false,
    ),
    groupBatchSize: parseIntegerEnv(
      env,
      ENV_KEYS.groupBatchSize,
      DEFAULT_CONFIG.groupBatchSize,
      false,
    ),
    repoBatchSize: parseIntegerEnv(
      env,
      ENV_KEYS.repoBatchSize,
      DEFAULT_CONFIG.repoBatchSize,
      false,
    ),
    deleteBatchSize: parseIntegerEnv(
      env,
      ENV_KEYS.deleteBatchSize,
      DEFAULT_CONFIG.deleteBatchSize,
      false,
    ),
    groupBatchPauseMs: parseIntegerEnv(
      env,
      ENV_KEYS.groupBatchPauseMs,
      DEFAULT_CONFIG.groupBatchPauseMs,
      true,
    ),
    repoBatchPauseMs: parseIntegerEnv(
      env,
      ENV_KEYS.repoBatchPauseMs,
      DEFAULT_CONFIG.repoBatchPauseMs,
      true,
    ),
    deleteBatchPauseMs: parseIntegerEnv(
      env,
      ENV_KEYS.deleteBatchPauseMs,
      DEFAULT_CONFIG.deleteBatchPauseMs,
      true,
    ),
    groupApplyStaggerMs: parseIntegerEnv(
      env,
      ENV_KEYS.groupApplyStaggerMs,
      DEFAULT_CONFIG.groupApplyStaggerMs,
      true,
    ),
    repoApplyStaggerMs: parseIntegerEnv(
      env,
      ENV_KEYS.repoApplyStaggerMs,
      DEFAULT_CONFIG.repoApplyStaggerMs,
      true,
    ),
    deleteStaggerMs: parseIntegerEnv(
      env,
      ENV_KEYS.deleteStaggerMs,
      DEFAULT_CONFIG.deleteStaggerMs,
      true,
    ),
    minCoreRateRemaining: parseIntegerEnv(
      env,
      ENV_KEYS.minCoreRateRemaining,
      DEFAULT_CONFIG.minCoreRateRemaining,
      true,
    ),
    rateResetCushionMs: parseIntegerEnv(
      env,
      ENV_KEYS.rateResetCushionMs,
      DEFAULT_CONFIG.rateResetCushionMs,
      true,
    ),
    disableSleepGuards: parseBooleanFlagEnv(env, DISABLE_SLEEP_GUARDS_ENV_KEY),
  };
}

export function splitBatches<T>(items: T[], batchSize: number): T[][] {
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error('batchSize must be a positive integer');
  }

  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += batchSize) {
    batches.push(items.slice(index, index + batchSize));
  }

  return batches;
}

export function buildMassivePlan(
  prefix: string,
  repoCount: number,
  groupCount: number,
): MassivePlan {
  if (!Number.isInteger(repoCount) || repoCount <= 0) {
    throw new Error('repoCount must be a positive integer');
  }
  if (!Number.isInteger(groupCount) || groupCount <= 0) {
    throw new Error('groupCount must be a positive integer');
  }

  const groups = Array.from({ length: groupCount }, (_, index) => {
    const suffix = `group-${padded(index + 1)}`;
    const name = `${prefix}-${suffix}`;
    return {
      claimName: name,
      providerName: name,
      displayName: `Massive ${suffix}`,
      description: `Massive e2e generated group ${padded(index + 1)}`,
      fixtureName: 'group-a' as const,
    };
  });

  const repositories = Array.from({ length: repoCount }, (_, index) => {
    const suffix = `repo-${padded(index + 1)}`;
    const name = `${prefix}-${suffix}`;
    const owner = groups[index % groups.length];
    return {
      claimName: name,
      providerName: name,
      ownerRef: `group:${owner.claimName}`,
      description: `Massive e2e generated repository ${padded(index + 1)}`,
      topics: [prefix, suffix],
      features: [{ name: 'tech_docs', version: '0.10.2' }],
      fixtureName: 'component-a' as const,
    };
  });

  const canaryName = `${prefix}-canary`;
  const canaryCreate: MassiveRepositoryTemplate = {
    claimName: canaryName,
    providerName: canaryName,
    ownerRef: `group:${groups[0].claimName}`,
    description: 'Massive e2e canary repository',
    topics: [prefix, 'canary'],
    features: [{ name: 'tech_docs', version: '0.10.2' }],
    fixtureName: 'component-a',
  };

  return {
    groups,
    repositories,
    canary: {
      create: canaryCreate,
      modified: {
        ...canaryCreate,
        description: 'Massive e2e canary repository modified',
        topics: [prefix, 'canary', 'modified'],
      },
    },
  };
}
