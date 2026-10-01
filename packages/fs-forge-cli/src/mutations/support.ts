import { Flags } from '@oclif/core';
import { readFile } from 'fs/promises';
import { join } from 'path';
import YAML from 'yaml';

import { deriveVariantGroups } from '../utils/deriveFlags.js';

import type { ClaimKind } from './definitions.js';
import type { VariantGroup } from '../utils/deriveFlags.js';

export const MUTATION_CONTROL_FLAGS = {
  org: Flags.string({
    description: 'GitHub organization containing the claims repo',
    env: 'FSCRT_ORG',
  }),
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
      'After provisioning, watch wet PR check runs until completion (requires --commit)',
  }),
  'state-repos': Flags.string({
    description:
      'Comma-separated state repos for --wait-for-checks (default: <org>/state-github,<org>/state-infra)',
  }),
};

export function requireOrg(org: string | undefined): string {
  if (!org) throw new Error('--org or FSCRT_ORG is required');
  return org;
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
