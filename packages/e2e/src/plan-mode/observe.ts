export type PlanLogLine = {
  kind: string;
  name: string;
  operation: string;
  counts?: { add: number; change: number; destroy: number };
  artifactMd: string;
};

export type PlanArtifact = {
  kind: string;
  name: string;
  operation: string;
  result: {
    status: string;
    add?: number;
    change?: number;
    destroy?: number;
  };
  plan: unknown;
};

const PLAN_LINE = /^PLAN (\S+)\/(\S+) (\S+): (.*) \((.+\.md)\)$/;
const PLANNED_OUTCOME = /^\+(\d+) ~(\d+) -(\d+)$/;

export function parsePlanLogLine(line: string): PlanLogLine | undefined {
  const match = line.trim().match(PLAN_LINE);
  if (!match) return undefined;

  const [, kind, name, operation, outcome, artifactMd] = match;
  const counts = outcome.match(PLANNED_OUTCOME);

  return {
    kind,
    name,
    operation,
    artifactMd,
    counts: counts
      ? {
          add: Number(counts[1]),
          change: Number(counts[2]),
          destroy: Number(counts[3]),
        }
      : undefined,
  };
}

// Returns the latest plan line for one CR and operation: a CR can be planned
// again by a later reconciliation.
export function findPlanLogLine(
  logs: string,
  kind: string,
  name: string,
  operation: string,
): PlanLogLine | undefined {
  let found: PlanLogLine | undefined;

  for (const line of logs.split('\n')) {
    const parsed = parsePlanLogLine(line);
    if (
      parsed &&
      parsed.kind === kind &&
      parsed.name === name &&
      parsed.operation === operation
    ) {
      found = parsed;
    }
  }

  return found;
}

export function assertArtifactMatchesLog(
  artifact: PlanArtifact,
  logLine: PlanLogLine,
): void {
  const where = `${logLine.kind}/${logLine.name} ${logLine.operation}`;

  if (artifact.kind !== logLine.kind || artifact.name !== logLine.name) {
    throw new Error(
      `Plan artifact is for ${artifact.kind}/${artifact.name}, expected ${where}`,
    );
  }
  if (artifact.operation !== logLine.operation) {
    throw new Error(
      `Plan artifact operation ${artifact.operation} does not match log ${where}`,
    );
  }
  if (logLine.counts) {
    const { result } = artifact;
    const mismatch =
      result.add !== logLine.counts.add ||
      result.change !== logLine.counts.change ||
      result.destroy !== logLine.counts.destroy;
    if (mismatch) {
      throw new Error(
        `Plan artifact counts ${JSON.stringify(result)} do not match log ${where} ` +
          `+${logLine.counts.add} ~${logLine.counts.change} -${logLine.counts.destroy}`,
      );
    }
  }
}

export function assertPlanned(artifact: PlanArtifact, operation: string): void {
  if (artifact.operation !== operation) {
    throw new Error(
      `Expected operation ${operation} for ${artifact.kind}/${artifact.name}, got ${artifact.operation}`,
    );
  }
  if (artifact.result.status !== 'PLANNED') {
    throw new Error(
      `Expected PLANNED for ${artifact.kind}/${artifact.name}, got ${artifact.result.status}`,
    );
  }
  if (artifact.plan === null || artifact.plan === undefined) {
    throw new Error(
      `Plan artifact for ${artifact.kind}/${artifact.name} has no plan`,
    );
  }
}

export type ObservedFields = {
  status?: unknown;
  finalizers?: unknown;
};

/**
 * Plan mode only observes: `status` (conditions included) and finalizers must
 * be byte-identical before and after a plan. resourceVersion is not compared,
 * because the suite's own spec changes and deletes bump it.
 */
export function assertObserveOnly(
  kind: string,
  name: string,
  before: ObservedFields,
  after: ObservedFields,
): void {
  if (
    JSON.stringify(before.status ?? null) !==
    JSON.stringify(after.status ?? null)
  ) {
    throw new Error(`Plan mode changed status of ${kind}/${name}`);
  }
  if (
    JSON.stringify(before.finalizers ?? []) !==
    JSON.stringify(after.finalizers ?? [])
  ) {
    throw new Error(`Plan mode changed finalizers of ${kind}/${name}`);
  }
}
