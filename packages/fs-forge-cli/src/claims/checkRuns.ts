import type { CheckRunSummary, GitHubApi, RepoRef } from '../github/api.js';

export interface CheckRunResult {
  name: string;
  conclusion: string | null;
  status: string;
  output: CheckRunOutput;
  htmlUrl: string | null;
}

export interface CheckRunOutput {
  title: string | null;
  summary: string;
  text: string | null;
}

export interface CheckRunAnnotation {
  path: string;
  startLine: number;
  endLine: number;
  annotationLevel: string;
  message: string;
  title: string | null;
}

export interface AggregatedCheckResult {
  overallConclusion: string;
  checkRuns: CheckRunResult[];
  perCrStatus: Map<string, CrCheckStatus>;
}

export interface CrCheckStatus {
  crName: string;
  conclusion: string;
  summary: string;
  annotations: CheckRunAnnotation[];
}

export interface WatchCheckOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 10_000;

export async function watchCheckRuns(
  api: GitHubApi,
  ref: RepoRef,
  prNumber: number,
  options: WatchCheckOptions = {},
): Promise<AggregatedCheckResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const checkRuns = await api.listCheckRunsForPullRequest(ref, prNumber);
    const allCompleted = checkRuns.every((cr) => cr.status === 'completed');

    if (allCompleted) {
      return aggregateResults(checkRuns);
    }

    await sleep(pollIntervalMs);
  }

  const checkRuns = await api.listCheckRunsForPullRequest(ref, prNumber);
  const aggregated = aggregateResults(checkRuns);
  aggregated.overallConclusion = 'timeout';
  return aggregated;
}

export async function pointInTimeCheck(
  api: GitHubApi,
  ref: RepoRef,
  prNumber: number,
): Promise<AggregatedCheckResult> {
  const checkRuns = await api.listCheckRunsForPullRequest(ref, prNumber);
  return aggregateResults(checkRuns);
}

function aggregateResults(checkRuns: CheckRunSummary[]): AggregatedCheckResult {
  const results: CheckRunResult[] = checkRuns.map((cr) => ({
    name: cr.name,
    conclusion: cr.conclusion,
    status: cr.status,
    output: cr.output,
    htmlUrl: cr.htmlUrl,
  }));

  const overallConclusion = deriveOverallConclusion(results);
  const perCrStatus = extractPerCrStatus(results);

  return { overallConclusion, checkRuns: results, perCrStatus };
}

function deriveOverallConclusion(checkRuns: CheckRunResult[]): string {
  if (checkRuns.length === 0) return 'no_checks';

  const conclusions = checkRuns.map((cr) => cr.conclusion ?? cr.status);

  if (conclusions.every((c) => c === 'success')) return 'success';
  if (conclusions.some((c) => c === 'failure')) return 'failure';
  if (conclusions.some((c) => c === 'cancelled')) return 'cancelled';
  if (conclusions.some((c) => c === 'timed_out')) return 'timed_out';

  return checkRuns.some((cr) => cr.status !== 'completed')
    ? 'pending'
    : 'success';
}

function extractPerCrStatus(
  checkRuns: CheckRunResult[],
): Map<string, CrCheckStatus> {
  const perCr = new Map<string, CrCheckStatus>();

  for (const cr of checkRuns) {
    const names = parseCrNamesFromSummary(cr.output.summary);
    for (const crName of names) {
      const existing = perCr.get(crName);
      if (!existing) {
        perCr.set(crName, {
          crName,
          conclusion: cr.conclusion ?? cr.status,
          summary: cr.output.summary,
          annotations: [],
        });
      }
    }
  }

  return perCr;
}

export function parseCrNamesFromSummary(summary: string): string[] {
  const crNames: string[] = [];
  const lines = summary.split('\n');
  for (const line of lines) {
    const match = line.match(
      /^(\w[\w./-]+)\s*[:]\s*(success|failure|skipped|pending)/i,
    );
    if (match) {
      crNames.push(match[1]);
    }
  }
  return crNames;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
