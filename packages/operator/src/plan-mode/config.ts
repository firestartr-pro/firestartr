export const DEFAULT_PLAN_OUTPUT_DIR = '/tmp/plans';

export type PlanModeConfig = Readonly<{
  enabled: boolean;
  outputDir: string;
}>;

export type PlanModeInput = {
  flag?: boolean;
  env?: string;
  outputDir?: string;
};

export class InvalidPlanModeError extends Error {
  constructor(value: string) {
    super(
      `OPERATOR_PLAN_MODE must be 'true' or 'false' (or unset), got '${value}'; refusing to start`,
    );

    this.name = 'InvalidPlanModeError';
  }
}

export function resolvePlanModeConfig(input: PlanModeInput): PlanModeConfig {
  const { flag, env, outputDir } = input;

  if (env !== undefined && env !== 'true' && env !== 'false') {
    throw new InvalidPlanModeError(env);
  }

  return Object.freeze({
    enabled: flag === true || env === 'true',
    outputDir: outputDir || DEFAULT_PLAN_OUTPUT_DIR,
  });
}

let config: PlanModeConfig = resolvePlanModeConfig({});

let initialized = false;

/**
 * Fixes Plan mode for the life of the process. It is read once at startup and
 * can never be switched afterwards.
 */
export function initPlanMode(input: PlanModeInput): PlanModeConfig {
  if (initialized) {
    throw new Error('Plan mode is fixed at startup and cannot be set twice');
  }

  config = resolvePlanModeConfig(input);

  initialized = true;

  return config;
}

export function isPlanMode(): boolean {
  return config.enabled;
}

export function getPlanOutputDir(): string {
  return config.outputDir;
}
