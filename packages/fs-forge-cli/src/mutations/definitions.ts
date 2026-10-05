import CreateArgodeploy from '../commands/create/argodeploy.js';
import CreateComponent from '../commands/create/component.js';
import CreateDomain from '../commands/create/domain.js';
import CreateGroup from '../commands/create/group.js';
import CreateOrgsettings from '../commands/create/orgsettings.js';
import CreateOrgwebhook from '../commands/create/orgwebhook.js';
import CreateSecrets from '../commands/create/secrets.js';
import CreateSystem from '../commands/create/system.js';
import CreateTfworkspace from '../commands/create/tfworkspace.js';
import CreateUser from '../commands/create/user.js';

import {
  CLAIM_KIND_OPTIONS,
  isClaimKind,
  normalizeKind,
} from '../claims/kindRegistry.js';

import type { ClaimKindName } from '../claims/kinds.js';
import type { FlagSpec } from '../utils/deriveFlags.js';

const CREATE_COMMANDS = {
  ArgoDeployClaim: CreateArgodeploy,
  ComponentClaim: CreateComponent,
  DomainClaim: CreateDomain,
  GroupClaim: CreateGroup,
  OrgSettingsClaim: CreateOrgsettings,
  OrgWebhookClaim: CreateOrgwebhook,
  SecretsClaim: CreateSecrets,
  SystemClaim: CreateSystem,
  TFWorkspaceClaim: CreateTfworkspace,
  UserClaim: CreateUser,
};

export type ClaimKind = ClaimKindName;

export const FLAG_SPECS_BY_KIND = Object.fromEntries(
  Object.entries(CREATE_COMMANDS).map(([kind, command]) => [
    kind,
    command.FLAG_SPECS,
  ]),
) as Record<ClaimKind, FlagSpec[]>;

const MUTATION_FLAGS = Object.fromEntries(
  Object.values(CREATE_COMMANDS).flatMap((command) => {
    const schemaFlags = new Set(command.FLAG_SPECS.map(({ path }) => path));
    return Object.entries(command.flags)
      .filter(([name]) => schemaFlags.has(name))
      .map(([name, flag]) => [
        name,
        {
          ...flag,
          required: false,
          default: undefined,
          ...(flag.type === 'boolean' ? { allowNo: true } : {}),
        },
      ]);
  }),
);

export function mutationFlagsWithout(...names: string[]) {
  return Object.fromEntries(
    Object.entries(MUTATION_FLAGS).filter(([name]) => !names.includes(name)),
  );
}

export { CLAIM_KIND_OPTIONS, isClaimKind };
export const normalizeClaimKind = normalizeKind;

export function assertMutationFlags(
  kind: ClaimKind,
  flags: Record<string, unknown>,
): void {
  const allowed = new Set(FLAG_SPECS_BY_KIND[kind].map(({ path }) => path));
  const invalid = Object.keys(flags).filter(
    (name) =>
      flags[name] !== undefined &&
      Object.values(FLAG_SPECS_BY_KIND).some((specs) =>
        specs.some(({ path }) => path === name),
      ) &&
      !allowed.has(name),
  );
  if (invalid.length > 0) {
    throw new Error(
      `Flags not supported for ${kind}: ${invalid.map((name) => `--${name}`).join(', ')}`,
    );
  }
}
