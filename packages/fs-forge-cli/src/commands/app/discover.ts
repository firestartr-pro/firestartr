import { Command, Flags } from '@oclif/core';

import { discoverApp, formatDiscoverSummary } from '../../app/discover.js';
import { AppError } from '../../app/errors.js';
import { resolveClaimsRepository } from '../../context/resolve.js';
import { createGitHubApi } from '../../github/index.js';
import { ORG_FLAG, requireOrg } from '../../mutations/support.js';
import {
  createFeatureSource,
  DEFAULT_FEATURE_SOURCE,
} from '../../utils/featureSource.js';

import type {
  AppDiscoverResult,
  DiscoverAppOptions,
} from '../../app/discover.js';

function writeLine(value: string): void {
  process.stdout.write(`${value}\n`);
}

export default class AppDiscover extends Command {
  static description =
    'Discover platform, ArgoCD, and service facts for an app (read-only)';

  static examples = [
    '<%= config.bin %> <%= command.id %> --app my-app --json',
    '<%= config.bin %> <%= command.id %> --app my-app --service my-svc --org my-org',
  ];

  static flags = {
    app: Flags.string({
      description: 'Application name',
      required: true,
    }),
    service: Flags.string({
      description:
        'Service (component) name; defaults to the only service in apps/<app>.yaml',
    }),
    org: {
      ...ORG_FLAG,
      description: 'GitHub organization',
    },
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
    const { flags } = await this.parse(AppDiscover);
    const org = requireOrg(flags.org);
    const claimsTarget = resolveClaimsRepository(org, flags['claims-repo']);

    const result = await this.discover(
      {
        api: createGitHubApi(),
        org,
        claimsRepoName: claimsTarget.repo,
        app: flags.app,
        service: flags.service,
        featureSource: createFeatureSource(DEFAULT_FEATURE_SOURCE),
      },
      flags.json,
    );

    if (flags.json) {
      writeLine(JSON.stringify(result, null, 2));
      return;
    }

    writeLine(formatDiscoverSummary(result));
  }

  private async discover(
    options: DiscoverAppOptions,
    json: boolean,
  ): Promise<AppDiscoverResult> {
    try {
      return await discoverApp(options);
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      this.fail(json, error);
    }
  }

  private fail(json: boolean, error: AppError): never {
    if (!json) this.error(error.message, { code: error.code, exit: 1 });
    process.stderr.write(
      `${JSON.stringify({ error: { code: error.code, message: error.message } })}\n`,
    );
    this.exit(1);
  }
}
