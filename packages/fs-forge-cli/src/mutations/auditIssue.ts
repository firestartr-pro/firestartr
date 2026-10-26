import type { ClaimsRepo } from '../claims/claimsRepo.js';

/**
 * The optional audit trail that `--commit` commands carry: a claims-repo issue
 * that the claim PR closes on merge (`--issue` / `--create-issue`).
 */

export type AuditOperation = 'create' | 'edit' | 'delete';

/** The `--issue*` and `--create-issue*` flags, as parsed by oclif. */
export interface AuditIssueOptions {
  issue?: number;
  createIssue?: boolean;
  issueTitle?: string;
  issueBody?: string;
}

export interface AuditTrailContext {
  /** The claims repo the command already resolved; never resolved twice. */
  repo: ClaimsRepo;
  operation: AuditOperation;
  kind: string;
  name: string;
}

/** What the JSON result reports about the audit trail. */
export interface AuditIssueRef {
  number: number;
  url: string;
}

export interface AuditPullRequestRef {
  number: number;
  url: string;
}

export interface AuditResult {
  issue?: AuditIssueRef;
  pr?: AuditPullRequestRef;
}

export interface AuditTrail {
  /** Opens (or adopts) the audit issue; call before any branch is created. */
  begin(): Promise<void>;
  /** Opens the claims PR with a `Closes #N` footer, or adds it to the existing one. */
  linkPullRequest(input: { head: string; base: string }): Promise<void>;
  /** Comments the dispatched workflow run on the issue, best effort. */
  commentRunUrl(runUrl: string): Promise<void>;
  /** Closes the issue after a successful delete, best effort. */
  closeIssue(): Promise<void>;
  /** Comments the error on an issue this run created, then stays out of the way. */
  fail(error: unknown): Promise<void>;
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
export function redactTokens(message: string): string {
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
export function closesFooter(body: string, issue: number): string {
  if (new RegExp(`\\bCloses\\s+#${issue}\\b`, 'i').test(body)) return body;
  const trimmed = body.replace(/\s+$/, '');
  return trimmed ? `${trimmed}\n\nCloses #${issue}` : `Closes #${issue}`;
}

function defaultTitle(context: AuditTrailContext): string {
  return `${VERBS[context.operation]} ${shortKind(context.kind)} ${context.name}`;
}

function defaultBody(context: AuditTrailContext): string {
  const repo = `${context.repo.ref.owner}/${context.repo.ref.repo}`;
  return [
    '## Goal',
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Best effort: the claim mutation already succeeded, so a bookkeeping failure
 * must not turn the command into an error.
 */
async function bestEffort(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch {
    // The audit trail is a convenience; the mutation result stands.
  }
}

export function createAuditTrail(
  context: AuditTrailContext,
  options: AuditIssueOptions,
): AuditTrail {
  const { repo } = context;
  let issue: AuditIssueRef | undefined;
  let pullRequest: AuditPullRequestRef | undefined;
  let createdIssue = false;
  let failureReported = false;

  return {
    async begin() {
      if (options.issue !== undefined && options.createIssue) {
        throw new Error('--issue and --create-issue are mutually exclusive');
      }
      if (options.issue !== undefined) {
        if (!Number.isInteger(options.issue) || options.issue <= 0) {
          throw new Error('--issue must be a positive issue number');
        }
        issue = { number: options.issue, url: issueUrl(context, options.issue) };
        return;
      }
      if (!options.createIssue) return;

      const created = await repo.api.createIssue(repo.ref, {
        title: options.issueTitle ?? defaultTitle(context),
        body: options.issueBody ?? defaultBody(context),
      });
      issue = { number: created.number, url: created.htmlUrl };
      createdIssue = true;
    },

    async linkPullRequest({ head, base }) {
      if (!issue) return;
      const body = closesFooter('', issue.number);
      const existing = (await repo.api.listOpenPullRequests(repo.ref)).find(
        (candidate) => candidate.headRef === head,
      );
      if (!existing) {
        const created = await repo.api.createPullRequest(repo.ref, {
          head,
          base,
          title: `ci: provision claim ${context.kind}/${context.name}`,
          body,
        });
        pullRequest = { number: created.number, url: created.htmlUrl };
        return;
      }

      const updated = closesFooter(existing.body ?? '', issue.number);
      if (updated !== existing.body) {
        await repo.api.updatePullRequest(repo.ref, existing.number, {
          body: updated,
        });
      }
      pullRequest = { number: existing.number, url: existing.htmlUrl };
    },

    async commentRunUrl(runUrl) {
      if (!issue) return;
      await bestEffort(() =>
        repo.api.commentOnIssue(repo.ref, issue!.number, `Workflow run: ${runUrl}`),
      );
    },

    async closeIssue() {
      if (!issue) return;
      await bestEffort(() => repo.api.closeIssue(repo.ref, issue!.number));
    },

    async fail(error) {
      if (!createdIssue || failureReported) return;
      failureReported = true;
      const body = [
        `The ${context.operation} of ${context.kind}-${context.name} failed; this issue stays open.`,
        '',
        redactTokens(errorMessage(error)),
      ].join('\n');
      await bestEffort(() => repo.api.commentOnIssue(repo.ref, issue!.number, body));
    },

    result() {
      const result: AuditResult = {};
      if (issue) result.issue = issue;
      if (pullRequest) result.pr = pullRequest;
      return result;
    },
  };
}
