import { Command, Flags } from '@oclif/core';

import {
  applyApp,
  type ApplyOutcome,
  type ApplyPrRef,
  type ApplyStepResult,
  DEFAULT_APPLY_TIMEOUT_MS,
} from '../../app/apply/index.js';
import { loadAppCommandInputs } from '../../app/commandInputs.js';
import {
  buildPlanJsonOutput,
  formatPlanChecksAndConflicts,
  type PlanCheck,
  planApp,
  type PlanConflict,
} from '../../app/plan/index.js';
import { createGitHubApi } from '../../github/index.js';
import type { Pulse } from '../../mutations/publish.js';
import {
  auditTrailOptions,
  STANDALONE_AUDIT_TRAIL_FLAGS,
} from '../../mutations/support.js';
import {
  createFeatureSource,
  DEFAULT_FEATURE_SOURCE,
} from '../../utils/featureSource.js';

export const APP_APPLY_EXIT_CODES = {
  done: 0,
  failed: 1,
  not_ready: 1,
  error: 2,
  pending: 3,
} as const;

export interface AppApplyJsonOutput {
  org: string;
  app: string;
  outcome: ApplyOutcome;
  steps: ApplyStepResult[];
  auditIssue?: ApplyPrRef;
  reason?: string;
  checks?: PlanCheck[];
  conflicts?: PlanConflict[];
}

function writeLine(value: string): void {
  process.stdout.write(`${value}\n`);
}

function formatApplySummary(output: AppApplyJsonOutput): string {
  const lines: string[] = [];
  lines.push(`App apply: ${output.app} (org: ${output.org})`);

  if (output.auditIssue) {
    lines.push(
      `Audit issue: #${output.auditIssue.number} (${output.auditIssue.url})`,
    );
  }

  for (const step of output.steps) {
    lines.push('');
    lines.push(`Step ${step.step}:`);
    for (const repo of step.repos) {
      const prPart = repo.pr ? ` ${repo.pr.url}` : '';
      const reasonPart = repo.reason ? ` — ${repo.reason}` : '';
      lines.push(
        `  - ${repo.repo} (${repo.branch}): ${repo.state}${prPart}${reasonPart}`,
      );
    }
  }

  lines.push('');
  if (output.outcome === 'done') {
    lines.push('Done: all steps completed.');
  } else if (output.outcome === 'pending') {
    if (output.reason) {
      lines.push(`Pending: ${output.reason}`);
    }
    lines.push('rerun `fs-forge app apply` with the same inputs to resume');
  } else if (output.outcome === 'failed') {
    lines.push(`Failed: ${output.reason ?? 'apply failed'}`);
  }

  return lines.join('\n');
}

export default class AppApply extends Command {
  static description =
    'Open and track PRs in plan order to deploy or update an app';

  static examples = [
    '<%= config.bin %> <%= command.id %> --inputs app-inputs.yaml',
    '<%= config.bin %> <%= command.id %> --inputs app-inputs.yaml --no-wait',
    '<%= config.bin %> <%= command.id %> --inputs app-inputs.yaml --timeout 900 --json',
    '<%= config.bin %> <%= command.id %> --inputs app-inputs.yaml --create-issue --issue-title "Deploy payments"',
    '<%= config.bin %> <%= command.id %> --inputs app-inputs.yaml --issue 42',
  ];

  static flags = {
    inputs: Flags.string({
      description: 'Path to the AppInputs YAML file',
      required: true,
    }),
    'no-wait': Flags.boolean({
      description:
        'Open PRs for the current step without waiting for merges or provisioning',
      default: false,
    }),
    timeout: Flags.integer({
      description: 'Per-step timeout in seconds',
      default: DEFAULT_APPLY_TIMEOUT_MS / 1000,
      min: 1,
    }),
    ...STANDALONE_AUDIT_TRAIL_FLAGS,
    org: Flags.string({
      description:
        'GitHub organization (overrides inputs file; falls back to FSCRT_ORG or context config)',
    }),
    app: Flags.string({
      description: 'Application name (overrides inputs file)',
    }),
    'org-plan': Flags.string({
      description: 'Override GitHub organization plan detection',
      options: ['free', 'paid'],
    }),
    'claims-repo': Flags.string({
      description:
        'Repository name for the claims repo (default: config, then claims)',
    }),
    json: Flags.boolean({
      description: 'Output as JSON',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(AppApply);

    let loaded;
    try {
      loaded = await loadAppCommandInputs({
        inputsPath: flags.inputs,
        configRoot: this.config.root,
        app: flags.app,
        org: flags.org,
        claimsRepo: flags['claims-repo'],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.error(message, { exit: APP_APPLY_EXIT_CODES.error });
    }

    let api;
    let planResult;
    try {
      api = createGitHubApi();
      planResult = await planApp({
        api,
        featureSource: createFeatureSource(DEFAULT_FEATURE_SOURCE),
        inputs: loaded.inputs,
        org: loaded.org,
        orgPlan: flags['org-plan'] as 'free' | 'paid' | undefined,
        claimsRepoName: loaded.claimsRepoName,
        schemaDirs: loaded.schemaDirs,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.error(message, { exit: APP_APPLY_EXIT_CODES.error });
    }

    const planOutput = buildPlanJsonOutput(planResult);
    if (!planOutput.ready) {
      const notReadyOutput: AppApplyJsonOutput = {
        org: planOutput.org,
        app: planOutput.app,
        outcome: 'not_ready',
        steps: [],
        reason: 'Plan has failing checks or conflicts.',
        checks: planOutput.checks,
        conflicts: planOutput.conflicts,
      };
      if (flags.json) {
        writeLine(JSON.stringify(notReadyOutput, null, 2));
      } else {
        writeLine(formatPlanChecksAndConflicts(planOutput));
      }
      this.exit(APP_APPLY_EXIT_CODES.not_ready);
    }

    const pulse: Pulse = flags.json
      ? { output: () => {}, diagnostic: () => {} }
      : {
          output: (line) => writeLine(line),
          diagnostic: (line) => {
            process.stderr.write(`${line}\n`);
          },
        };

    let applyResult;
    try {
      applyResult = await applyApp(api, planResult, {
        noWait: flags['no-wait'],
        timeoutMs: flags.timeout * 1000,
        audit: auditTrailOptions(flags),
        pulse,
        ...(flags.json
          ? { dispatchPresentation: { stdout: () => {}, stderr: () => {} } }
          : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.error(message, { exit: APP_APPLY_EXIT_CODES.error });
    }

    const output: AppApplyJsonOutput = {
      org: planOutput.org,
      app: planOutput.app,
      outcome: applyResult.outcome,
      steps: applyResult.steps,
      ...(applyResult.auditIssue ? { auditIssue: applyResult.auditIssue } : {}),
      ...(applyResult.reason ? { reason: applyResult.reason } : {}),
    };

    if (flags.json) {
      writeLine(JSON.stringify(output, null, 2));
    } else {
      writeLine(formatApplySummary(output));
    }

    const exitCode = APP_APPLY_EXIT_CODES[output.outcome];
    if (exitCode !== 0) {
      this.exit(exitCode);
    }
  }
}
