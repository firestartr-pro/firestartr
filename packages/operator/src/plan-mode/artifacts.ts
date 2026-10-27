import * as fs from 'fs/promises';
import * as path from 'path';

import { getPlanOutputDir } from './config';

export type PlanCounts = { add: number; change: number; destroy: number };

export type PlanResult =
  | { status: 'PLANNED'; counts: PlanCounts; text: string; json: any }
  | { status: 'NOTHING' }
  | { status: 'SKIPPED'; reason: string }
  | { status: 'ERROR'; reason: string };

export type PlanRecord = {
  kind: string;
  name: string;
  namespace: string;
  operation: string;
  planCommand?: 'plan' | 'plan-destroy';
  policy: string;
  plannedAt: string;
  lock: 'none';
  result: PlanResult;
};

export type PlanArtifactPaths = { md: string; json: string };

export function describeResult(result: PlanResult): string {
  switch (result.status) {
    case 'PLANNED':
      return `~${result.counts.change} change, +${result.counts.add} add, -${result.counts.destroy} destroy`;
    case 'NOTHING':
      return 'NOTHING (no plan needed)';
    case 'SKIPPED':
      return `SKIPPED (${result.reason})`;
    case 'ERROR':
      return `ERROR ${result.reason}`;
  }
}

export function renderPlanMarkdown(record: PlanRecord): string {
  const lines = [
    `# ${record.kind}/${record.name}`,
    `- Operation: ${record.operation}   Policy: ${record.policy}   Planned at: ${record.plannedAt}   Lock: ${record.lock}`,
    `- Result: ${describeResult(record.result)}`,
  ];

  if (record.result.status === 'PLANNED') {
    lines.push('', '## Plan', record.result.text.trimEnd());
  }

  return `${lines.join('\n')}\n`;
}

export function renderPlanJson(record: PlanRecord) {
  const { result } = record;

  return {
    kind: record.kind,
    name: record.name,
    namespace: record.namespace,
    operation: record.operation,
    planCommand: record.planCommand ?? null,
    policy: record.policy,
    plannedAt: record.plannedAt,
    lock: record.lock,
    result: {
      status: result.status,
      summary: describeResult(result),
      ...(result.status === 'PLANNED' ? result.counts : {}),
      ...(result.status === 'SKIPPED' || result.status === 'ERROR'
        ? { reason: result.reason }
        : {}),
    },
    plan: result.status === 'PLANNED' ? result.json : null,
  };
}

export function planSummaryLine(
  record: PlanRecord,
  paths: PlanArtifactPaths,
): string {
  const { result } = record;

  const outcome =
    result.status === 'PLANNED'
      ? `+${result.counts.add} ~${result.counts.change} -${result.counts.destroy}`
      : describeResult(result);

  return `PLAN ${record.kind}/${record.name} ${record.operation}: ${outcome} (${paths.md})`;
}

async function writeFileAtomically(file: string, content: string) {
  const tmp = `${file}.tmp`;

  // Plans can hold sensitive values: never reuse a leftover temp file, and
  // create it owner-only before any content lands in it.
  await fs.rm(tmp, { force: true });

  await fs.writeFile(tmp, content, { mode: 0o600, flag: 'wx' });

  await fs.rename(tmp, file);
}

/**
 * Writes `<dir>/<kind>/<name>.md` and `.json`, replacing the previous plan of
 * the same CR so the directory always holds the latest view.
 */
export async function writePlanArtifacts(
  record: PlanRecord,
  outputDir: string = getPlanOutputDir(),
): Promise<PlanArtifactPaths> {
  const dir = path.join(outputDir, record.kind);

  await fs.mkdir(dir, { recursive: true });

  const paths = {
    md: path.join(dir, `${record.name}.md`),
    json: path.join(dir, `${record.name}.json`),
  };

  await writeFileAtomically(paths.md, renderPlanMarkdown(record));

  await writeFileAtomically(
    paths.json,
    `${JSON.stringify(renderPlanJson(record), null, 2)}\n`,
  );

  return paths;
}
