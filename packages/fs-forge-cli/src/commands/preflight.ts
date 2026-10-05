import { Command, Errors, Flags } from '@oclif/core';

import { KIND_CAPABILITIES } from '../claims/kindRegistry.js';
import { claimExists } from '../claims/claimsMap.js';
import { claimsRepo, loadClaimsMap } from '../claims/claimsRepo.js';

import type { ClaimsRepo } from '../claims/claimsRepo.js';
import { createGitHubApi } from '../github/index.js';
import { requireOrg } from '../mutations/support.js';

import type { PreflightKindId } from '../claims/kindRegistry.js';
import type { ClaimKindName } from '../claims/kinds.js';

/** Presentation order of `--kind`; must match the registry's preflight kinds. */
const PREFLIGHT_KIND_IDS = [
  'repo',
  'team',
  'user',
  'tfworkspace',
] as const satisfies readonly PreflightKindId[];

function preflightKind(id: PreflightKindId): ClaimKindName {
  const capability = KIND_CAPABILITIES.find(
    (candidate) => candidate.preflight === id,
  );
  if (!capability) {
    throw new Error(`No claim kind declares preflight kind ${id}`);
  }
  return capability.kind;
}

export const PREFLIGHT_KINDS: Record<PreflightKindId, ClaimKindName> =
  Object.fromEntries(
    PREFLIGHT_KIND_IDS.map((id) => [id, preflightKind(id)]),
  ) as Record<PreflightKindId, ClaimKindName>;

interface JsonOutput {
  status: string;
  kind: string;
  name: string;
  conflict?: string;
}

function jsonOutput(
  cmd: Command,
  exitCode: number,
  details: JsonOutput,
): never {
  process.stdout.write(`${JSON.stringify(details)}\n`);
  cmd.exit(exitCode);
}

export default class Preflight extends Command {
  static description =
    'Check claim and provider availability before creating, editing, or deleting a claim';

  static flags = {
    create: Flags.boolean({
      description: 'Check if a new claim can be created',
    }),
    edition: Flags.boolean({
      description: 'Check if an existing claim can be edited (renamed)',
    }),
    deletion: Flags.boolean({
      description: 'Check if a claim exists for deletion',
    }),
    kind: Flags.string({
      description: 'Provider kind (repo, team, user, tfworkspace)',
      options: PREFLIGHT_KIND_IDS,
      required: true,
    }),
    name: Flags.string({
      description: 'Claim name (assumed == provider identifier)',
      required: true,
    }),
    'old-name': Flags.string({
      description: 'Current claim name before rename (edition only)',
    }),
    org: Flags.string({
      description: 'GitHub organization',
      env: 'FSCRT_ORG',
    }),
    scope: Flags.string({
      description: 'What to check: claims, provider, or all',
      options: ['all', 'claims', 'provider'],
      default: 'all',
    }),
    json: Flags.boolean({
      description: 'Output as JSON',
    }),
  };

  static examples = [
    '<%= config.bin %> <%= command.id %> --create --kind repo --name my-service --org my-org',
    '<%= config.bin %> <%= command.id %> --create --kind repo --name my-service --scope claims --org my-org',
    '<%= config.bin %> <%= command.id %> --create --kind repo --name my-service --org my-org --json',
    '<%= config.bin %> <%= command.id %> --edition --kind repo --old-name old-api --name new-api --org my-org',
    '<%= config.bin %> <%= command.id %> --deletion --kind repo --name my-service --org my-org',
    '<%= config.bin %> <%= command.id %> --create --kind user --name octocat --org my-org',
  ];

  async run(): Promise<void> {
    const { flags } = await this.parse(Preflight);

    const selectedCount =
      Number(Boolean(flags.create)) +
      Number(Boolean(flags.edition)) +
      Number(Boolean(flags.deletion));
    if (selectedCount === 0) {
      this.error('One of --create, --edition, or --deletion is required');
    }
    if (selectedCount > 1) {
      this.error('--create, --edition, and --deletion are mutually exclusive');
    }

    const subcommand = flags.create
      ? 'create'
      : flags.edition
        ? 'edition'
        : 'deletion';

    const kindId = flags.kind as PreflightKindId;
    const claimKind = PREFLIGHT_KINDS[kindId];
    const name = flags.name;
    const scope = flags.scope;
    const org = requireOrg(flags.org);
    const repo = claimsRepo(createGitHubApi(), org);

    // --- DELETION ---
    if (subcommand === 'deletion') {
      const map = await loadClaimsMap(repo);
      if (!claimExists(map, claimKind, name)) {
        if (flags.json) {
          jsonOutput(this, 3, {
            status: 'not_found',
            kind: claimKind,
            name,
          });
        }
        this.error(`claim "${claimKind}-${name}" not found`, { exit: 3 });
      }
      if (flags.json) {
        jsonOutput(this, 0, { status: 'ok', kind: claimKind, name });
      }
      this.log(`OK: claim "${claimKind}-${name}" found`);
      return;
    }

    // --- EDITION ---
    if (subcommand === 'edition') {
      const oldName = flags['old-name'];
      if (!oldName) {
        this.error('--old-name is required for --edition');
      }
      const map = await loadClaimsMap(repo);
      if (!claimExists(map, claimKind, oldName)) {
        if (flags.json) {
          jsonOutput(this, 3, {
            status: 'not_found',
            kind: claimKind,
            name: oldName,
          });
        }
        this.error(`claim "${claimKind}-${oldName}" not found`, { exit: 3 });
      }

      if (oldName === name) {
        if (flags.json) {
          jsonOutput(this, 0, {
            status: 'ok',
            kind: claimKind,
            name: oldName,
          });
        }
        this.log(
          `OK: claim "${claimKind}-${oldName}" exists (no identity change)`,
        );
        return;
      }

      if (flags.json) {
        process.stdout.write(
          `${JSON.stringify({ status: 'ok', kind: claimKind, name: oldName })}\n`,
        );
      } else {
        this.log(`OK: claim "${claimKind}-${oldName}" exists`);
      }

      if (scope === 'claims') {
        return;
      }

      await this.checkProvider(repo, kindId, name, flags.json);
      return;
    }

    // --- CREATE ---
    if (scope === 'claims' || scope === 'all') {
      const map = await loadClaimsMap(repo);
      if (claimExists(map, claimKind, name)) {
        if (flags.json) {
          jsonOutput(this, 1, {
            status: 'conflict',
            conflict: 'claim',
            kind: claimKind,
            name,
          });
        }
        this.error(`${kindId} "${name}" already exists in claims`, { exit: 1 });
      }
      if (scope === 'claims' || kindId === 'tfworkspace') {
        if (flags.json) {
          jsonOutput(this, 0, { status: 'ok', kind: claimKind, name });
        }
        this.log(`${claimKind} "${name}" is not declared in claims`);
        return;
      }
    }

    if (scope === 'provider' || scope === 'all') {
      await this.checkProvider(repo, kindId, name, flags.json);
    }
  }

  private async checkProvider(
    repo: ClaimsRepo,
    kindId: PreflightKindId,
    name: string,
    json: boolean,
  ): Promise<void> {
    if (kindId === 'tfworkspace') {
      if (json) {
        process.stdout.write(
          `${JSON.stringify({ status: 'ok', kind: 'TFWorkspaceClaim', name })}\n`,
        );
        process.exit(0);
      }
      this.log('OK: nothing to check (tfworkspace is claims-only)');
      return;
    }

    try {
      let exists: boolean;
      switch (kindId) {
        case 'repo':
          exists = await repo.api.repoExists({
            owner: repo.ref.owner,
            repo: name,
          });
          break;
        case 'team':
          exists = await repo.api.teamExists(repo.ref.owner, name);
          break;
        case 'user':
          exists = await repo.api.userIsOrgMember(repo.ref.owner, name);
          break;
        default:
          return;
      }

      if (exists) {
        if (json) {
          jsonOutput(this, 2, {
            status: 'conflict',
            conflict: 'provider',
            kind: PREFLIGHT_KINDS[kindId],
            name,
          });
        }
        this.error(
          `${kindId} "${name}" already exists in GitHub (no claim for it) — use import process`,
          { exit: 2 },
        );
      }

      if (json) {
        jsonOutput(this, 0, {
          status: 'ok',
          kind: PREFLIGHT_KINDS[kindId],
          name,
        });
      }
      this.log(`${kindId} "${name}" is available`);
    } catch (error) {
      if (error instanceof Errors.CLIError) throw error;
      const status = (error as Record<string, unknown>)?.status as
        | number
        | undefined;
      if (status === 401 || status === 403) {
        if (json) {
          jsonOutput(this, 4, {
            status: 'error',
            kind: PREFLIGHT_KINDS[kindId],
            name,
          });
        }
        this.error(
          'GITHUB_TOKEN does not have sufficient scopes (need read:org, repo)',
          { exit: 4 },
        );
      }
      if (json) {
        jsonOutput(this, 5, {
          status: 'error',
          kind: PREFLIGHT_KINDS[kindId],
          name,
        });
      }
      this.error('cannot reach GitHub API', { exit: 5 });
    }
  }
}
