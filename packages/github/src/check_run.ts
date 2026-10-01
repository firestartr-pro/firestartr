import type { Octokit } from '@octokit/rest';
import { getOctokitForOrg } from './auth';

import { getPrMergeCommitSHA } from './pull_request';
import { upsertMultiPartStickyComments } from './sticky_comment';
import logger from './logger';

export type CheckRunStatus = 'queued' | 'in_progress' | 'completed';
export type CheckRunConclusion =
  | 'success'
  | 'failure'
  | 'neutral'
  | 'cancelled'
  | 'timed_out'
  | 'action_required'
  | 'skipped';

const FLUSH_TIMEOUT = 4; // seconds
const GITHUB_OUTPUT_TEXT_LIMIT = 65000; // ~65k hard limit for output.text

/**
 * Streams text updates to a callback on a fixed cadence, with a size-triggered early flush.
 * Does NOT clear content on flush (so the consumer can send the full, current log each time).
 */
class CheckRunBuffer {
  private content: string;
  private updated: boolean;
  private timer: ReturnType<typeof setInterval> | null;
  private readonly onFlush: (data: string) => void;
  private readonly flushIntervalMs: number;

  constructor(
    initial = '',
    onFlush: (data: string) => void,
    opts?: { intervalSec?: number; sizeTrigger?: number },
  ) {
    this.content = initial;
    this.updated = Boolean(initial);
    this.onFlush = onFlush;
    this.flushIntervalMs = (opts?.intervalSec ?? FLUSH_TIMEOUT) * 1000;

    this.timer = setInterval(() => {
      this.flush();
    }, this.flushIntervalMs);

    if (initial) this.flush();
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  update(data = ''): void {
    if (!data) return;
    this.content += data;
    this.updated = true;
  }

  flush(): void {
    if (!this.updated) return;
    try {
      this.onFlush(this.content);
    } finally {
      this.updated = false;
    }
  }

  snapshot(): string {
    return this.content;
  }
}

export interface GithubCheckRunParams {
  owner: string;
  repo: string;
  headSHA: string;
  name: string;
  detailsUrl?: string;
  title?: string;
  summary?: string;
  pullNumber?: number;
  includeCheckRunComment?: boolean;
  checkRunComment?: string;
  /**
   * Optional shared sticky base kind for this check run's sticky PR
   * comment. When set, progress upserts use this base kind (instead of
   * the default `check-run:<name>`) and `close()` performs no sticky
   * rewrite, so an external result publisher targeting the same base
   * kind is always the last word. When unset, legacy behavior is
   * unchanged.
   */
  stickyCommentBaseKind?: string;
}

export class GithubCheckRun {
  private readonly octokit: Octokit;
  private readonly owner: string;
  private readonly repo: string;
  private readonly headSHA: string;
  private readonly name: string;
  private readonly detailsUrl?: string;
  private readonly title: string;
  private readonly pullNumber?: number;
  private readonly includeCheckRunComment: boolean;
  private readonly checkRunComment?: string;
  private readonly stickyCommentBaseKind?: string;
  private hasCommented = false;
  private creatingPromise?: Promise<void>;

  private closing = false;
  private closed = false;
  private buffer: CheckRunBuffer;
  private checkRunId?: number;
  private lastStatus: Exclude<CheckRunStatus, 'completed'> = 'in_progress';
  private detailsFormatter: (s: string) => string = (s) => s;
  private _summaryOverride?: string;

  constructor(octokit: Octokit, params: GithubCheckRunParams) {
    this.octokit = octokit;
    this.owner = params.owner;
    this.repo = params.repo;
    this.headSHA = params.headSHA;
    this.name = params.name;
    this.detailsUrl = params.detailsUrl;
    this.title = params.title ?? params.name;
    if (params.summary) this._summaryOverride = params.summary;

    this.pullNumber = params.pullNumber;
    this.includeCheckRunComment = Boolean(params.includeCheckRunComment);
    this.checkRunComment = params.checkRunComment;
    this.stickyCommentBaseKind = params.stickyCommentBaseKind;

    this.buffer = new CheckRunBuffer(
      '',
      (data: string) => this.__updateCheckRun(data).catch(() => {}),
      { intervalSec: FLUSH_TIMEOUT },
    );
  }

  /**
   * Configure markdown formatting for the details (output.text).
   * Example: ch.mdOptionsDetails({ quotes: 'terraform' })
   * Result:
   * ```terraform
   * <log>
   * ```
   */
  mdOptionsDetails(opts: { quotes: string }): void {
    const lang = (opts?.quotes ?? '').trim();
    if (!lang) {
      this.detailsFormatter = (s) => s;
      return;
    }

    const fenceOpen = '```' + lang + '\n';
    const fenceClose = '\n```';
    const overhead = fenceOpen.length + fenceClose.length;

    this.detailsFormatter = (body: string) => {
      const maxBody = Math.max(0, GITHUB_OUTPUT_TEXT_LIMIT - overhead);
      const safeBody =
        body.length > maxBody ? truncateRight(body, maxBody) : body;
      return fenceOpen + safeBody + fenceClose;
    };
  }

  set summary(data: string) {
    this._summaryOverride = data;
    // Push an immediate update if already created and not closed.
    if (!this.closed && this.checkRunId) {
      // do not mutate buffer flags; just send current snapshot using new summary
      this.__updateCheckRun(this.buffer.snapshot()).catch(() => {});
    }
  }

  get summary(): string | undefined {
    return this._summaryOverride;
  }

  /**
   * Append log text and optionally set status ('queued' | 'in_progress').
   */
  update(text: string, status?: Exclude<CheckRunStatus, 'completed'>): void {
    if (this.closed) return;
    if (status) this.lastStatus = status;
    if (text) this.buffer.update(text);
  }

  /**
   * Finalize the check with a conclusion. Flushes buffered text, marks completed.
   */
  async close(finalText: string, ok: boolean): Promise<void> {
    if (this.closed || this.closing) return;
    this.closing = true;

    this.buffer.stop();

    const finalContent = this.buffer.snapshot() + (finalText || '');

    try {
      await this.__ensureCreated();

      const { text, summary } = this.buildOutputTextAndSummary(finalContent);

      await this.octokit.rest.checks.update({
        owner: this.owner,
        repo: this.repo,
        check_run_id: this.checkRunId!,
        conclusion: ok ? 'success' : 'failure',
        completed_at: new Date().toISOString(),
        output: {
          title: this.title,
          summary,
          text,
        },
      });

      // With a shared sticky base kind, the result publisher targeting the
      // same base kind is always the last word: close() performs no sticky
      // rewrite (it could otherwise land after the result publish on error
      // paths and clobber it with a stale progress comment).
      if (
        this.includeCheckRunComment &&
        this.pullNumber !== undefined &&
        !this.stickyCommentBaseKind
      ) {
        try {
          await this.__ensureAndUpdateStickyComment(this.__buildCheckRunUrl());
          this.hasCommented = true;
        } catch {
          logger.warn('Error creating check run comment');
        }
      }

      this.closed = true;
    } catch (e) {
      logger.error(e);
    } finally {
      this.closing = false;
    }
  }

  // -------------------- Internals --------------------

  private async __ensureCreated(): Promise<void> {
    if (this.checkRunId) return;
    if (this.creatingPromise) return this.creatingPromise;

    this.creatingPromise = (async () => {
      const startedAt = new Date().toISOString();
      const res = await this.octokit.rest.checks.create({
        owner: this.owner,
        repo: this.repo,
        name: this.name,
        head_sha: this.headSHA,
        status: 'in_progress',
        started_at: startedAt,
        details_url: this.detailsUrl,
        output: {
          title: this.title,
          summary: this._summaryOverride ?? '',
          text: undefined,
        },
      });

      this.checkRunId = res.data.id;
    })();

    try {
      await this.creatingPromise;
    } finally {
      this.creatingPromise = undefined;
    }
  }

  private async __updateCheckRun(allContent: string): Promise<void> {
    if (this.closed || this.closing) return;
    await this.__ensureCreated();

    const { text, summary } = this.buildOutputTextAndSummary(allContent);

    await this.octokit.rest.checks.update({
      owner: this.owner,
      repo: this.repo,
      check_run_id: this.checkRunId!,
      status: this.lastStatus,
      output: {
        title: this.title,
        summary,
        text,
      },
    });

    // After the awaits above, close() may have begun. With a shared sticky
    // base kind the result publisher must be the last word, so an in-flight
    // progress upsert must not land after it. Legacy flows (no shared base
    // kind) keep their current behavior.
    const closedMidFlight =
      this.stickyCommentBaseKind && (this.closed || this.closing);

    if (
      this.includeCheckRunComment &&
      this.pullNumber !== undefined &&
      !closedMidFlight
    ) {
      try {
        await this.__ensureAndUpdateStickyComment(this.__buildCheckRunUrl());
      } catch (e) {
        logger.warn('Error updating check run comment:', e);
      }
    }
  }

  private __buildCheckRunUrl(): string {
    if (this.checkRunId) {
      return `https://github.com/${this.owner}/${this.repo}/runs/${this.checkRunId}?check_suite_focus=true`;
    }
    return `https://github.com/${this.owner}/${this.repo}/commit/${this.headSHA}/checks?check_suite_focus=true`;
  }

  private buildOutputTextAndSummary(full: string): {
    text: string | undefined;
    summary: string;
  } {
    if (!full) {
      return {
        text: undefined,
        summary: this._summaryOverride ?? '',
      };
    }

    let text = this.detailsFormatter(full);
    let truncated = false;

    if (text.length > GITHUB_OUTPUT_TEXT_LIMIT) {
      text = truncateRight(text, GITHUB_OUTPUT_TEXT_LIMIT);
      truncated = true;
    } else {
      truncated = text.length < full.length;
    }

    let summary = this._summaryOverride ?? '';
    if (this._summaryOverride && truncated) {
      summary = `${summary}\n\n... (log truncated to ~${GITHUB_OUTPUT_TEXT_LIMIT.toLocaleString()} chars)`;
    }

    return { text, summary };
  }

  // Ensure a sticky comment exists and rewrite it entirely with the latest content.
  private async __ensureAndUpdateStickyComment(link: string): Promise<void> {
    if (!this.includeCheckRunComment || this.pullNumber === undefined) return;

    const base = this.checkRunComment ?? '';
    const linkLine = base ? `${base}[here](${link})` : `[here](${link})`;

    await upsertMultiPartStickyComments(this.octokit as any, {
      owner: this.owner,
      repo: this.repo,
      pullNumber: this.pullNumber,
      baseKind: this.stickyCommentBaseKind ?? `check-run:${this.name}`,
      bodies: [linkLine],
    });
  }
}

// -------------------- Helpers --------------------

function truncateRight(s: string, max: number): string {
  if (s.length <= max) return s;
  const HARD = Math.max(0, max - 3);
  return s.slice(0, HARD) + '...';
}

/**
 * Factory: build a GithubCheckRun using an installation token for the given org.
 */
export async function createCheckRunForOrg(
  org: string,
  owner: string,
  repo: string,
  name: string,
  opts?: {
    headSHA?: string;
    pullNumber?: number;
    detailsUrl?: string;
    title?: string;
    summary?: string;
    includeCheckRunComment?: boolean;
    checkRunComment?: string;
    stickyCommentBaseKind?: string;
  },
): Promise<GithubCheckRun> {
  const octokit = await getOctokitForOrg(org);

  let headSHA = opts?.headSHA;

  const pr = opts?.pullNumber;
  const hasValidPrNumber =
    typeof pr === 'number' && Number.isInteger(pr) && pr > 0;

  if (!headSHA && hasValidPrNumber) {
    headSHA = await getPrMergeCommitSHA(pr, repo, owner);
  }
  if (!headSHA) {
    throw new Error(
      'createCheckRunForOrg: either opts.headSHA or opts.pullNumber must be provided',
    );
  }

  logger.debug(`Creating check run ${name} in ${owner}/${repo} at ${headSHA}`);
  return new GithubCheckRun(octokit, {
    owner,
    repo,
    headSHA,
    name,
    detailsUrl: opts?.detailsUrl,
    title: opts?.title,
    summary: opts?.summary,
    pullNumber: opts?.pullNumber,
    includeCheckRunComment: Boolean(opts?.includeCheckRunComment),
    checkRunComment: opts?.checkRunComment,
    stickyCommentBaseKind: opts?.stickyCommentBaseKind,
  });
}

export async function createCheckRun(
  owner: string,
  repo: string,
  name: string,
  opts?: {
    headSHA?: string;
    pullNumber?: number;
    detailsUrl?: string;
    title?: string;
    summary?: string;
    includeCheckRunComment?: boolean;
    checkRunComment?: string;
    stickyCommentBaseKind?: string;
  },
): Promise<GithubCheckRun> {
  logger.debug(`Creating check run ${name} in ${owner}/${repo}`);
  return createCheckRunForOrg(owner, owner, repo, name, opts);
}

export const CheckRun = GithubCheckRun;
