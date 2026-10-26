import type { ClaimsRepo } from '../claims/claimsRepo.js';

export type AuditOperation = 'create' | 'edit' | 'delete';

/** The `--issue*` and `--create-issue*` flags, as parsed by oclif. */
export interface AuditTrailOptions {
  issue?: number;
  createIssue?: boolean;
  issueTitle?: string;
  issueBody?: string;
}

/**
 * The audit wording for a mutation that reaches past the claim itself, such as
 * a Feature change inside a ComponentClaim.
 */
export interface AuditChange {
  /** The issue title, e.g. `Add feature logging to component app`. */
  title: string;
  /** The Goal sentence naming what the run changes. */
  goal: string;
}

export interface AuditTrailContext {
  /** The claims repo the command already resolved. */
  repo: ClaimsRepo;
  operation: AuditOperation;
  kind: string;
  name: string;
  /** Defaults to the claim itself when the mutation only touches it. */
  change?: AuditChange;
}

/** What the JSON result reports about the audit trail. */
export type AuditResult = {
  issue?: AuditRef;
  pr?: AuditRef;
};

/** An issue or pull request in the claims repo, reduced to what the CLI reports. */
interface AuditRef {
  number: number;
  url: string;
}

/** The audit actions a commit step performs while it runs. */
export interface AuditTrail {
  /** Opens the claims PR with a `Closes #N` footer, or adds it to the open one. */
  linkPullRequest(input: { head: string; base: string }): Promise<void>;
  /** Comments the dispatched workflow run on the issue, best effort. */
  commentRunUrl(runUrl: string): Promise<void>;
  /** Closes the issue once the run concluded, best effort. */
  closeIssue(): Promise<void>;
  /** The keys the command reports in its JSON outcome. */
  result(): AuditResult;
}

const VERBS: Record<AuditOperation, string> = {
  create: 'Create',
  edit: 'Edit',
  delete: 'Delete',
};

const TOKEN_PATTERNS = [
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{10,}/g,
];

function shortKind(kind: string): string {
  return kind.replace(/Claim$/i, '').toLowerCase();
}

/** Replaces anything token-shaped before an error reaches an issue comment. */
function redactTokens(message: string): string {
  let redacted = message;
  for (const token of [process.env.GITHUB_TOKEN, process.env.FSCRT_TOKEN]) {
    if (token && token.length >= 8) {
      redacted = redacted.split(token).join('***');
    }
  }
  for (const pattern of TOKEN_PATTERNS) {
    redacted = redacted.replace(pattern, '***');
  }
  return redacted;
}

/** Adds `Closes #N` once, keeping any body the PR already had. */
function closesFooter(body: string, issue: number): string {
  if (new RegExp(`\\bCloses\\s+#${issue}\\b`, 'i').test(body)) return body;
  const trimmed = body.replace(/\s+$/, '');
  return trimmed ? `${trimmed}\n\nCloses #${issue}` : `Closes #${issue}`;
}

function defaultTitle(context: AuditTrailContext): string {
  return (
    context.change?.title ??
    `${VERBS[context.operation]} ${shortKind(context.kind)} ${context.name}`
  );
}

function defaultBody(context: AuditTrailContext): string {
  const repo = `${context.repo.ref.owner}/${context.repo.ref.repo}`;
  return [
    '## Goal',
    context.change?.goal ??
      `Audit trail for the ${context.operation} of \`${context.kind}-${context.name}\`.`,
    '',
    '## Requested change',
    `- **Kind:** \`${context.kind}\``,
    `- **Name:** \`${context.name}\``,
    `- **Claims repo:** \`${repo}\``,
  ].join('\n');
}

function issueUrl(context: AuditTrailContext, issue: number): string {
  const { owner, repo } = context.repo.ref;
  return `https://github.com/${owner}/${repo}/issues/${issue}`;
}

/**
 * The audit trail is a convenience: bookkeeping must never turn a finished
 * mutation into an error.
 */
async function bestEffort(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch {
    // Swallowed on purpose.
  }
}

/** Opens the audit issue, or adopts `--issue`; nothing at all without flags. */
async function resolveIssue(
  context: AuditTrailContext,
  options: AuditTrailOptions,
): Promise<{ ref?: AuditRef; created: boolean }> {
  if (options.issue !== undefined) {
    if (!Number.isInteger(options.issue) || options.issue <= 0) {
      throw new Error('--issue must be a positive issue number');
    }
    return {
      ref: { number: options.issue, url: issueUrl(context, options.issue) },
      created: false,
    };
  }
  if (!options.createIssue) return { created: false };

  const { api, ref } = context.repo;
  const created = await api.createIssue(ref, {
    title: options.issueTitle ?? defaultTitle(context),
    body: options.issueBody ?? defaultBody(context),
  });
  return {
    ref: { number: created.number, url: created.htmlUrl },
    created: true,
  };
}

interface OpenedAudit {
  trail: AuditTrail;
  /** Comments the error on an issue this run created; adopted issues stay untouched. */
  reportFailure(error: unknown): Promise<void>;
}

async function openAudit(
  context: AuditTrailContext,
  options: AuditTrailOptions,
): Promise<OpenedAudit> {
  const { api, ref: repoRef } = context.repo;
  const { ref: issue, created } = await resolveIssue(context, options);
  let pullRequest: AuditRef | undefined;

  const trail: AuditTrail = {
    async linkPullRequest({ head, base }) {
      if (!issue) return;
      const existing = (await api.listOpenPullRequests(repoRef)).find(
        (candidate) => candidate.headRef === head,
      );
      if (existing) {
        const updated = closesFooter(existing.body ?? '', issue.number);
        if (updated !== existing.body) {
          await api.updatePullRequest(repoRef, existing.number, {
            body: updated,
          });
        }
        pullRequest = { number: existing.number, url: existing.htmlUrl };
        return;
      }

      const opened = await api.createPullRequest(repoRef, {
        head,
        base,
        title: `ci: provision claim ${context.kind}/${context.name}`,
        body: closesFooter('', issue.number),
      });
      pullRequest = { number: opened.number, url: opened.htmlUrl };
    },

    async commentRunUrl(runUrl) {
      if (!issue) return;
      await bestEffort(() =>
        api.commentOnIssue(repoRef, issue.number, `Workflow run: ${runUrl}`),
      );
    },

    async closeIssue() {
      if (!issue) return;
      await bestEffort(() => api.closeIssue(repoRef, issue.number));
    },

    result() {
      const result: AuditResult = {};
      if (issue) result.issue = issue;
      if (pullRequest) result.pr = pullRequest;
      return result;
    },
  };

  return {
    trail,
    async reportFailure(error) {
      if (!created || !issue) return;
      const body = [
        `The ${context.operation} of ${context.kind}-${context.name} failed; this issue stays open.`,
        '',
        redactTokens(error instanceof Error ? error.message : String(error)),
      ].join('\n');
      await bestEffort(() => api.commentOnIssue(repoRef, issue.number, body));
    },
  };
}

/**
 * Runs the audited part of a `--commit` command: the issue is opened (or
 * adopted) before the step starts, so it exists before the first write, and a
 * failure is commented on an issue this run created. Recording the run is the
 * step's business: only it knows whether a run concluded.
 */
export async function withAuditTrail<T>(
  context: AuditTrailContext,
  options: AuditTrailOptions,
  step: (trail: AuditTrail) => Promise<T>,
): Promise<T> {
  const audit = await openAudit(context, options);
  try {
    return await step(audit.trail);
  } catch (error) {
    await audit.reportFailure(error);
    throw error;
  }
}
