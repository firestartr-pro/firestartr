import YAML from 'yaml';

import { isRecord } from '../../utils/isRecord.js';

export interface NameValueEntry {
  name: string;
  value: string;
}

export interface RequiredVarsAndSecrets {
  vars: string[];
  secrets: string[];
}

/**
 * Core vars and secrets written to `app-<app>` on a free GitHub plan,
 * following firestartr-bootstrap's rule (each uses its fixed
 * `ref:secretsclaim:firestartr-secrets:<key>` value).
 */
export const CORE_STATE_APP_VAR_NAMES = [
  'FS_STATE_APP_ID',
  'FS_CHECKS_APP_ID',
  'FIRESTARTR_CLI_VERSION',
] as const;

export const CORE_STATE_APP_SECRET_NAMES = [
  'FS_STATE_PEM_FILE',
  'FS_CHECKS_PEM_FILE',
  'PREFAPP_BOT_PAT',
] as const;

export function coreStateAppVars(): NameValueEntry[] {
  return CORE_STATE_APP_VAR_NAMES.map((name) => ({
    name,
    value: `ref:secretsclaim:firestartr-secrets:${name}`,
  }));
}

export function coreStateAppSecrets(): NameValueEntry[] {
  return CORE_STATE_APP_SECRET_NAMES.map((name) => ({
    name,
    value: `ref:secretsclaim:firestartr-secrets:${name}`,
  }));
}

/**
 * Registry and cloud vars/secrets needed by `state_repo_apps` workflows on `app-<app>`.
 *
 * Source: `prefapp/features@2ec427bbf26605be3a32ceade193f6ccf1dd595d`
 * `packages/state_repo_apps/templates/.github/workflows/`
 * (`generate-deployment-kubernetes.yml`, `validate-pr.yml`, `dispatch-image-kubernetes.yml`).
 * Upstream contract tracking: prefapp/features#1491.
 */
export function requiredStateAppRegistryVarsAndSecrets(
  authStrategy: string,
  ociCharts: boolean,
): RequiredVarsAndSecrets {
  const vars: string[] = [
    'DOCKER_REGISTRY_RELEASES',
    'DOCKER_REGISTRY_SNAPSHOTS',
  ];
  const secrets: string[] = [];

  if (ociCharts) {
    vars.push('HELM_CHARTS_PUBLICATION_TYPE');
  }

  switch (authStrategy) {
    case 'azure_oidc':
      vars.push('AZURE_CLIENT_ID', 'AZURE_SUBSCRIPTION_ID', 'AZURE_TENANT_ID');
      break;
    case 'aws_oidc':
      vars.push('AWS_DEFAULT_REGION', 'AWS_ROLE_ARN');
      break;
    case 'generic':
    case 'dockerhub':
    case 'ghcr':
      vars.push(
        'DOCKER_REGISTRY_RELEASES_USERNAME',
        'DOCKER_REGISTRY_SNAPSHOTS_USERNAME',
      );
      secrets.push(
        'DOCKER_REGISTRY_RELEASES_PASSWORD',
        'DOCKER_REGISTRY_SNAPSHOTS_PASSWORD',
      );
      break;
  }

  return { vars, secrets };
}

/**
 * Vars and secrets needed by `build_and_dispatch_docker_images` workflows on the Service repo.
 *
 * Source: `prefapp/features@2ec427bbf26605be3a32ceade193f6ccf1dd595d`
 * `packages/build_and_dispatch_docker_images/templates/.github/workflows/`
 * (`build_images_reusable_v4.yaml`, `make_dispatches.yaml`, `trigger_deployment.yaml`) and `README.md`.
 * Upstream contract tracking: prefapp/features#1491.
 */
export function requiredServiceVarsAndSecrets(
  authStrategy: string,
): RequiredVarsAndSecrets {
  const vars: string[] = [
    'FS_STATE_APP_ID',
    'FS_CHECKS_APP_ID',
    'DOCKER_REGISTRY_RELEASES',
    'DOCKER_REGISTRY_SNAPSHOTS',
    'DOCKER_REGISTRIES_BASE_PATHS',
  ];
  const secrets: string[] = ['FS_STATE_PEM_FILE', 'FS_CHECKS_PEM_FILE'];

  switch (authStrategy) {
    case 'azure_oidc':
      vars.push('AZURE_CLIENT_ID', 'AZURE_SUBSCRIPTION_ID', 'AZURE_TENANT_ID');
      break;
    case 'aws_oidc':
      vars.push('AWS_REGION', 'AWS_OIDC_ECR_ROLE');
      break;
    case 'generic':
    case 'dockerhub':
      secrets.push(
        'DOCKER_REGISTRY_RELEASES_CREDS',
        'DOCKER_REGISTRY_SNAPSHOTS_CREDS',
      );
      break;
    case 'ghcr':
      // GITHUB_DOCKER_REGISTRY_CREDS is optional; falls back to GITHUB_TOKEN.
      break;
  }

  return { vars, secrets };
}

function parseActionsEntries(raw: unknown): NameValueEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: NameValueEntry[] = [];
  for (const item of raw) {
    if (
      isRecord(item) &&
      typeof item.name === 'string' &&
      typeof item.value === 'string'
    ) {
      entries.push({ name: item.name, value: item.value });
    }
  }
  return entries;
}

/** Reads `providers.github.{vars,secrets}.actions` from a ComponentClaim YAML string. */
export function extractClaimVarsAndSecrets(claimContent: string): {
  vars: Map<string, string>;
  secrets: Map<string, string>;
} {
  const vars = new Map<string, string>();
  const secrets = new Map<string, string>();

  let parsed: unknown;
  try {
    parsed = YAML.parse(claimContent);
  } catch {
    return { vars, secrets };
  }
  if (!isRecord(parsed)) return { vars, secrets };

  const providers = isRecord(parsed.providers) ? parsed.providers : undefined;
  const github =
    providers && isRecord(providers.github) ? providers.github : undefined;
  if (!github) return { vars, secrets };

  if (isRecord(github.vars)) {
    for (const entry of parseActionsEntries(github.vars.actions)) {
      vars.set(entry.name, entry.value);
    }
  }
  if (isRecord(github.secrets)) {
    for (const entry of parseActionsEntries(github.secrets.actions)) {
      secrets.set(entry.name, entry.value);
    }
  }
  return { vars, secrets };
}
