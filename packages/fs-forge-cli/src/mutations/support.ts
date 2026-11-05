import { Flags } from '@oclif/core';
import { readFile } from 'fs/promises';
import { join } from 'path';
import YAML from 'yaml';

import { orgFromContext, resolveContext } from '../context/resolve.js';
import { deriveVariantGroups } from '../utils/deriveFlags.js';

import type { AuditTrailOptions } from './auditIssue.js';
import type { ClaimKind } from './definitions.js';
import type { VariantGroup } from '../utils/deriveFlags.js';

export const ORG_FLAG = Flags.string({
  description:
    'GitHub organization containing the claims repo (default: FSCRT_ORG, then the config entry matching the current directory)',
  env: 'FSCRT_ORG',
  // The default reads this machine's config file, so caching it would bake a
  // developer's org into oclif.manifest.json and ship it to every user.
  noCacheDefault: true,
  default: async () => orgFromContext(),
});

export const MUTATION_CONTROL_FLAGS = {
  org: ORG_FLAG,
  unset: Flags.string({
    description: 'Remove a dotted field path',
    multiple: true,
  }),
  diff: Flags.boolean({
    description: 'Print the claim diff to stderr',
  }),
  'show-defaults': Flags.boolean({
    description: 'Show defaults-filled fields in the diff (implies --diff)',
  }),
  json: Flags.boolean({
    description: 'Print the diff as JSON (requires --diff or --show-defaults)',
  }),
  commit: Flags.boolean({
    description:
      'Commit the claim and run the unattended provision workflow: open a PR, wait for verification, merge it, dispatch hydration, wait for it to finish, and merge the resulting second PR.',
  }),
  'no-wait': Flags.boolean({
    description: 'Skip waiting for the provision workflow to complete',
  }),
  'wait-for-checks': Flags.boolean({
    description:
      'After provisioning, watch wet PR check runs until completion (requires --commit; --no-wait-for-checks to skip)',
    default: true,
    allowNo: true,
  }),
  'state-repos': Flags.string({
    description:
      'Comma-separated state repos for --wait-for-checks (default: <org>/state-github,<org>/state-infra)',
  }),
};

/** The audit-trail flags every `--commit` command carries. */
export const AUDIT_TRAIL_FLAGS = {
  issue: Flags.integer({
    description:
      'Link the commit to an existing claims-repo issue (adds "Closes #N" to the claim PR)',
    dependsOn: ['commit'],
    exclusive: ['create-issue'],
  }),
  'create-issue': Flags.boolean({
    description:
      'Open an issue in the claims repo before committing, then link it to the claim PR',
    dependsOn: ['commit'],
    exclusive: ['issue'],
  }),
  'issue-title': Flags.string({
    description: 'Title for the issue opened by --create-issue',
    dependsOn: ['create-issue'],
  }),
  'issue-body': Flags.string({
    description: 'Body for the issue opened by --create-issue',
    dependsOn: ['create-issue'],
  }),
};

/** Maps the parsed `--issue*` flags onto the audit-trail options. */
export function auditTrailOptions(flags: {
  issue?: number;
  'create-issue'?: boolean;
  'issue-title'?: string;
  'issue-body'?: string;
}): AuditTrailOptions {
  return {
    issue: flags.issue,
    createIssue: flags['create-issue'],
    issueTitle: flags['issue-title'],
    issueBody: flags['issue-body'],
  };
}

/**
 * The `--org` value, which oclif already fills from `FSCRT_ORG`, then from the
 * config entry matching the current directory.
 */
export function requireOrg(
  parsedOrg: string | undefined,
  message = '--org or FSCRT_ORG is required',
): string {
  if (parsedOrg) return parsedOrg;
  const resolution = resolveContext();
  const error = resolution.ok ? undefined : resolution.error;
  throw new Error(
    error ? `${message} (${error.code}: ${error.message})` : message,
  );
}

export function parseClaimYaml(content: string): Record<string, unknown> {
  const claim: unknown = YAML.parse(content);
  if (typeof claim !== 'object' || claim === null || Array.isArray(claim)) {
    throw new Error('The claim file does not contain a YAML object');
  }
  return claim as Record<string, unknown>;
}

export function assertClaimIdentity(
  claim: Record<string, unknown>,
  kind: ClaimKind,
  name: string,
): void {
  if (claim.kind !== kind || claim.name !== name) {
    throw new Error(`Resolved claim identity does not match ${kind}-${name}`);
  }
}

export async function loadVariantGroups(
  root: string,
  kind: ClaimKind,
): Promise<VariantGroup[]> {
  const content = await readFile(join(root, 'schemas', `${kind}.json`), 'utf8');
  return deriveVariantGroups(JSON.parse(content) as Record<string, unknown>);
}
