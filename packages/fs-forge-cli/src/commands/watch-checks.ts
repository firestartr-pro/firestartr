import { Args, Command, Flags } from '@oclif/core';

import { claimsRepo } from '../claims/claimsRepo.js';

import type { ClaimsRepo } from '../claims/claimsRepo.js';
import { createGitHubApi } from '../github/index.js';
import {
  pointInTimeCheck,
  watchCheckRuns,
  type AggregatedCheckResult,
} from '../claims/checkRuns.js';
import { parseStateRepos, findWetPr, type WetPrInfo } from '../claims/wetPr.js';
import { ORG_FLAG } from '../mutations/support.js';
import { resolveClaimReference } from '../claims/kindRegistry.js';
import {
  findCrOnMainBranch,
  formatPrState,
  type CrInfo,
} from '../claims/stateRepo.js';

interface JsonOutput {
  status: string;
  mode: string;
  org: string;
  claimRef: string;
  wetPr?: {
    repo: string;
    number: number;
    url: string;
    state: string;
  };
  crs?: Array<{
    kind: string;
    name: string;
    path: string;
    content: string;
    lastStatePr: {
      repo: string;
      number: number;
      state: string | null;
      url: string | null;
    } | null;
    checks: Array<{
      name: string;
      conclusion: string | null;
      summary: string;
    }>;
  }>;
  overallConclusion?: string;
  exitCode: number;
}

export default class WatchChecks extends Command {
  static args = {
    reference: Args.string({
      description: 'Claim reference in <Kind>-<name> format',
      required: true,
    }),
  };

  static description =
    'Watch wet PR check runs for reconciliation status. Supports watch mode (default) and current mode (--current).';

  static examples = [
    '<%= config.bin %> <%= command.id %> ComponentClaim-my-app --org my-org',
    '<%= config.bin %> <%= command.id %> ComponentClaim-my-app --org my-org --current',
    '<%= config.bin %> <%= command.id %> ComponentClaim-my-app --org my-org --timeout 600',
  ];

  static flags = {
    org: ORG_FLAG,
    current: Flags.boolean({
      description:
        'Read CR from state repo main branch and show its last PR status',
      default: false,
    }),
    'state-repos': Flags.string({
      description:
        'Comma-separated state repos (default: <org>/state-github,<org>/state-infra)',
    }),
    timeout: Flags.integer({
      description: 'Timeout in seconds (default: 1800 = 30min)',
    }),
    json: Flags.boolean({
      description: 'Output as JSON',
      default: false,
    }),
    'cr-name': Flags.string({
      description: 'Filter to a specific CR name (current mode only)',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(WatchChecks);

    if (!flags.org) {
      this.error('--org or FSCRT_ORG is required');
    }

    const reference = resolveClaimReference(args.reference);
    if (!reference) {
      this.error(`Invalid claim reference: ${args.reference}`);
    }
    const { kind, name } = reference;

    const repo = claimsRepo(createGitHubApi(), flags.org);
    const stateRepos = parseStateRepos(flags['state-repos'], flags.org);
    const claimRef = `${kind}-${name}`;

    if (flags.current) {
      await this.runCurrentMode(repo, stateRepos, kind, name, claimRef, flags);
    } else {
      await this.runWatchMode(repo, stateRepos, kind, name, claimRef, flags);
    }
  }

  private async runWatchMode(
    repo: ClaimsRepo,
    stateRepos: string[],
    kind: string,
    name: string,
    claimRef: string,
    flags: {
      org?: string;
      current: boolean;
      'state-repos'?: string;
      timeout?: number;
      json: boolean;
      'cr-name'?: string;
    },
  ): Promise<void> {
    const wetPr = await findWetPr(repo.api, stateRepos, kind, name);

    if (!wetPr) {
      if (flags.json) {
        const output: JsonOutput = {
          status: 'error',
          mode: 'watch',
          org: flags.org!,
          claimRef,
          exitCode: 3,
        };
        process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
      } else {
        process.stderr.write(
          `No open wet PR found for ${claimRef} in state repos: ${stateRepos.join(', ')}\n`,
        );
      }
      this.exit(3);
      return;
    }

    const watchTarget = wetPr.lastStatePrRedirect
      ? {
          owner: wetPr.lastStatePrRedirect.owner,
          repo: wetPr.lastStatePrRedirect.repo,
          number: wetPr.lastStatePrRedirect.number,
          label: `${wetPr.lastStatePrRedirect.repo}#${wetPr.lastStatePrRedirect.number} (via last-state-pr from deletion PR ${wetPr.repo}#${wetPr.number})`,
        }
      : {
          owner: wetPr.owner,
          repo: wetPr.repo,
          number: wetPr.number,
          label: `${wetPr.repo}#${wetPr.number}`,
        };

    if (flags.json) {
      process.stderr.write(`Watching wet PR ${watchTarget.label}...\n`);
    } else {
      process.stderr.write(`Watching wet PR ${watchTarget.label}...\n`);
    }

    const timeoutMs = flags.timeout ? flags.timeout * 1000 : undefined;

    const watchRepoName = watchTarget.repo.split('/')[1];
    const result = await watchCheckRuns(
      repo.api,
      { owner: watchTarget.owner, repo: watchRepoName },
      watchTarget.number,
      { timeoutMs },
    );

    this.presentWatchResult(result, wetPr, watchTarget, claimRef, flags);
  }

  private presentWatchResult(
    result: AggregatedCheckResult,
    wetPr: WetPrInfo,
    watchTarget: { owner: string; repo: string; number: number; label: string },
    claimRef: string,
    flags: {
      org?: string;
      json: boolean;
    },
  ): void {
    if (flags.json) {
      const output: JsonOutput = {
        status: result.overallConclusion === 'success' ? 'ok' : 'error',
        mode: 'watch',
        org: flags.org!,
        claimRef,
        wetPr: {
          repo: watchTarget.repo,
          number: watchTarget.number,
          url: `https://github.com/${watchTarget.repo}/pull/${watchTarget.number}`,
          state: wetPr.lastStatePrRedirect ? 'redirected' : wetPr.state,
        },
        crs: Array.from(result.perCrStatus.values()).map((cr) => ({
          kind: cr.crName.split('/')[0] ?? '',
          name: cr.crName,
          path: '',
          content: '',
          lastStatePr: null,
          checks: [],
        })),
        overallConclusion: result.overallConclusion,
        exitCode:
          result.overallConclusion === 'success'
            ? 0
            : result.overallConclusion === 'timeout'
              ? 2
              : 1,
      };
      process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    } else {
      this.presentWatchTable(result);
    }

    if (result.overallConclusion === 'success') {
      process.stderr.write('All checks passed ✓\n');
      this.exit(0);
    } else if (result.overallConclusion === 'timeout') {
      process.stderr.write('Timed out waiting for checks\n');
      this.exit(2);
    } else {
      process.stderr.write('Some checks failed ✗\n');
      this.exit(1);
    }
  }

  private presentWatchTable(result: AggregatedCheckResult): void {
    if (result.checkRuns.length === 0) {
      process.stderr.write('No check runs found\n');
      return;
    }

    const nameW = Math.max(...result.checkRuns.map((cr) => cr.name.length), 4);
    const statusW = 10;

    process.stdout.write('\n');
    process.stdout.write(
      `${'Check Run'.padEnd(nameW)}  ${'Status'.padEnd(statusW)}  Summary\n`,
    );
    process.stdout.write(
      `${''.padEnd(nameW, '-')}  ${''.padEnd(statusW, '-')}  ${''.padEnd(30, '-')}\n`,
    );

    for (const cr of result.checkRuns) {
      const status = (cr.conclusion ?? cr.status).padEnd(statusW);
      const summary = truncateString(cr.output.summary, 60);
      process.stdout.write(`${cr.name.padEnd(nameW)}  ${status}  ${summary}\n`);
    }
    process.stdout.write('\n');
  }

  private async runCurrentMode(
    repo: ClaimsRepo,
    stateRepos: string[],
    kind: string,
    name: string,
    claimRef: string,
    flags: {
      org?: string;
      current: boolean;
      'state-repos'?: string;
      timeout?: number;
      json: boolean;
      'cr-name'?: string;
    },
  ): Promise<void> {
    const allCrInfo: CrInfo[] = [];

    for (const stateRepo of stateRepos) {
      const crs = await findCrOnMainBranch(repo.api, stateRepo, kind, name);
      allCrInfo.push(...crs);
    }

    const filteredCrs = flags['cr-name']
      ? allCrInfo.filter((cr) => cr.name === flags['cr-name'])
      : allCrInfo;

    if (filteredCrs.length === 0) {
      if (flags.json) {
        const output: JsonOutput = {
          status: 'error',
          mode: 'current',
          org: flags.org!,
          claimRef,
          exitCode: 3,
        };
        process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
      } else {
        process.stderr.write(
          `No CRs found for ${claimRef} in state repos: ${stateRepos.join(', ')}\n`,
        );
      }
      this.exit(3);
      return;
    }

    const output = await this.buildCurrentModeOutput(
      repo,
      filteredCrs,
      flags,
      claimRef,
    );

    if (flags.json) {
      process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    } else {
      this.presentCurrentTable(output);
    }

    if (output.status === 'ok') {
      this.exit(0);
    } else {
      this.exit(1);
    }
  }

  private async buildCurrentModeOutput(
    repo: ClaimsRepo,
    crs: CrInfo[],
    flags: {
      org?: string;
      json: boolean;
    },
    claimRef: string,
  ): Promise<JsonOutput> {
    const jsonCrs: NonNullable<JsonOutput['crs']> = [];
    let overallStatus = 'ok';

    for (const cr of crs) {
      let checks: Array<{
        name: string;
        conclusion: string | null;
        summary: string;
      }> = [];

      if (cr.lastStatePr) {
        try {
          const result = await pointInTimeCheck(
            repo.api,
            {
              owner: cr.lastStatePr.repo.split('/')[0]!,
              repo: cr.lastStatePr.repo.split('/')[1]!,
            },
            cr.lastStatePr.number,
          );
          checks = result.checkRuns.map((cr) => ({
            name: cr.name,
            conclusion: cr.conclusion,
            summary: cr.output.summary,
          }));
          if (result.overallConclusion !== 'success') {
            overallStatus = 'error';
          }
        } catch {
          overallStatus = 'error';
        }
      } else {
        overallStatus = 'error';
      }

      jsonCrs.push({
        kind: cr.kind,
        name: cr.name,
        path: cr.path,
        content: cr.content,
        lastStatePr: cr.lastStatePr,
        checks,
      });
    }

    return {
      status: overallStatus,
      mode: 'current',
      org: flags.org!,
      claimRef,
      crs: jsonCrs,
      exitCode: overallStatus === 'ok' ? 0 : 1,
    };
  }

  private presentCurrentTable(output: JsonOutput): void {
    if (!output.crs || output.crs.length === 0) return;

    for (const cr of output.crs) {
      process.stdout.write(`\nCR: ${cr.kind}/${cr.name}\n`);

      if (cr.lastStatePr) {
        const state = formatPrState(cr.lastStatePr.state);
        process.stdout.write(
          `PR: ${cr.lastStatePr.repo}#${cr.lastStatePr.number} (${state}) — ${cr.lastStatePr.url ?? 'unknown'}\n`,
        );
      } else {
        process.stdout.write('PR: unknown (no last-state-pr annotation)\n');
      }

      if (cr.checks.length > 0) {
        process.stdout.write('\nCheck runs:\n');
        for (const check of cr.checks) {
          process.stdout.write(
            `  ${check.name}: ${check.conclusion ?? 'pending'} — ${check.summary}\n`,
          );
        }
      } else {
        process.stdout.write('\nNo check runs found\n');
      }

      process.stdout.write('\nCR content (main branch):\n');
      const lines = cr.content.split('\n').slice(0, 20);
      for (const line of lines) {
        process.stdout.write(`  ${line}\n`);
      }
      if (cr.content.split('\n').length > 20) {
        process.stdout.write('  ... (truncated)\n');
      }
      process.stdout.write('\n');
    }
  }
}

function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}
