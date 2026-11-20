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

// eslint-disable-next-line no-control-regex -- matching the ESC byte is the point
const ANSI_ESCAPE = /\x1b\[[0-9;]*m/g;
const CONSOLE_LEVEL_PREFIX = /^\[[a-z]+\]:\s*/i;

// The operator logs JSON lines in-cluster and `[level]: message` with ANSI
// colours on a console: the plan message is the same in both.
export function logMessage(line: string): string {
  const trimmed = line.trim();

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed.message === 'string') return parsed.message;
    } catch {
      // not a JSON line: fall through to the console form
    }
  }

  return trimmed.replace(ANSI_ESCAPE, '').replace(CONSOLE_LEVEL_PREFIX, '');
}

export function parsePlanLogLine(line: string): PlanLogLine | undefined {
  const match = logMessage(line).match(PLAN_LINE);
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
  const { result } = artifact;
  if (result.status === 'PLANNED' && !logLine.counts) {
    throw new Error(
      `Plan artifact for ${where} is PLANNED but its log line has no counts`,
    );
  }
  if (logLine.counts) {
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

// A PLANNED artifact carries its Terraform plan in a fenced `## Plan` block:
// the heading alone is not a plan.
export function assertPlanMarkdown(markdown: string, planned: PlanLogLine) {
  const block = markdown.match(/## Plan\n(`{3,})text\n([\s\S]*?)\n\1/);

  if (!block || block[2].trim() === '') {
    throw new Error(
      `Plan markdown for ${planned.kind}/${planned.name} has no plan text`,
    );
  }
}
