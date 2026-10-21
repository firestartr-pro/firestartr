import { Command, Flags } from '@oclif/core';

import { NO_AUTH_MESSAGE, resolveAuth } from '../context/auth.js';
import {
  ContextError,
  contextRepos,
  resolveOrganization,
} from '../context/resolve.js';
import { latestCliVersion } from '../context/version.js';

import type { AuthSource } from '../context/auth.js';
import type {
  ContextRepos,
  ContextSource,
  OrganizationContext,
} from '../context/resolve.js';

interface ContextJson {
  org: string;
  source: ContextSource;
  matchedPath: string | null;
  repos: ContextRepos;
  cli: { version: string; latest: string | null; pinned: string | null };
  auth: { source: AuthSource };
}

export default class Context extends Command {
  static description =
    'Resolve and print the effective context: organization, repos, CLI version, and auth source';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --json',
    '<%= config.bin %> <%= command.id %> --org my-org',
  ];

  static flags = {
    org: Flags.string({
      description:
        'GitHub organization (default: FSCRT_ORG, then the config path match)',
    }),
    json: Flags.boolean({ description: 'Output as JSON' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Context);
    const json = flags.json;

    const organization = this.resolve(flags.org, json);
    const auth = resolveAuth();
    if (!auth) {
      this.fail(json, new ContextError('NO_AUTH', NO_AUTH_MESSAGE));
    }

    const context: ContextJson = {
      org: organization.org,
      source: organization.source,
      matchedPath: organization.matchedPath,
      repos: contextRepos(organization.org, organization.organization),
      cli: {
        version: this.config.version,
        latest: await latestCliVersion(),
        pinned: organization.cliVersion ?? null,
      },
      auth: { source: auth.source },
    };

    if (json) {
      process.stdout.write(`${JSON.stringify(context, null, 2)}\n`);
      return;
    }
    for (const line of formatContext(context)) this.log(line);
  }

  private resolve(
    flag: string | undefined,
    json: boolean,
  ): OrganizationContext {
    try {
      return resolveOrganization({ flag });
    } catch (error) {
      if (!(error instanceof ContextError)) throw error;
      this.fail(json, error);
    }
  }

  /** Non-zero exit, `{error: {code, message}}` on stderr when `--json`. */
  private fail(json: boolean, error: ContextError): never {
    if (!json) this.error(error.message, { code: error.code, exit: 1 });
    process.stderr.write(
      `${JSON.stringify({ error: { code: error.code, message: error.message } })}\n`,
    );
    this.exit(1);
  }
}

function formatContext(context: ContextJson): string[] {
  const origin = context.matchedPath
    ? `${context.source}: ${context.matchedPath}`
    : context.source;
  return [
    `org: ${context.org} (${origin})`,
    `claims: ${context.repos.claims}`,
    `state-github: ${context.repos.stateGithub}`,
    `state-infra: ${context.repos.stateInfra}`,
    `catalog: ${context.repos.catalog}`,
    `cli: ${context.cli.version} (latest: ${context.cli.latest ?? 'unknown'}, pinned: ${context.cli.pinned ?? 'none'})`,
    `auth: ${context.auth.source}`,
  ];
}
