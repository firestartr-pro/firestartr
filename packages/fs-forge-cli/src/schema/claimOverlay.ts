import type { ClaimIcon } from '../codegen/model.js';

/**
 * What fs-forge adds on top of the published claim schemas
 * (`@firestartr/firestartr-claims_schemas`). The package is the single source
 * of truth for the claim contract; this file only holds what belongs to the CLI.
 */

export interface ClaimPresentation {
  icon: ClaimIcon;
  summary: string;
}

/** Icon and one-line summary the generated commands show for each kind. */
export const CLAIM_PRESENTATION: Record<string, ClaimPresentation> = {
  ArgoDeployClaim: {
    icon: { emoji: '🚀', ascii: '[ARG]' },
    summary: 'Deploy an application to Argo CD from a claim.',
  },
  ComponentClaim: {
    icon: { emoji: '🧩', ascii: '[CMP]' },
    summary: 'Describe a software component and the repository that hosts it.',
  },
  DomainClaim: {
    icon: { emoji: '🌐', ascii: '[DOM]' },
    summary: 'Describe a domain that groups related systems and components.',
  },
  GroupClaim: {
    icon: { emoji: '👥', ascii: '[GRP]' },
    summary: 'Manage a GitHub team and its membership.',
  },
  OrgSettingsClaim: {
    icon: { emoji: '🏢', ascii: '[ORG]' },
    summary: 'Configure GitHub organization settings, variables, and secrets.',
  },
  OrgWebhookClaim: {
    icon: { emoji: '🪝', ascii: '[WHK]' },
    summary: 'Configure a webhook for a GitHub organization.',
  },
  SecretsClaim: {
    icon: { emoji: '🔑', ascii: '[SEC]' },
    summary: 'Manage external secrets for a platform resource.',
  },
  SystemClaim: {
    icon: { emoji: '🏗️', ascii: '[SYS]' },
    summary: 'Describe a system made up of related components.',
  },
  TFWorkspaceClaim: {
    icon: { emoji: '🧱', ascii: '[TFW]' },
    summary: 'Manage a Terraform workspace and its infrastructure state.',
  },
  UserClaim: {
    icon: { emoji: '👤', ascii: '[USR]' },
    summary: "Manage a GitHub user's organization membership.",
  },
};

/**
 * Keywords merged into the schema node found at a dotted property path
 * (`allOf` branches are searched). A path that matches nothing throws, so
 * schema drift surfaces instead of silently dropping a patch.
 */
export type SchemaPatches = Record<string, Record<string, unknown>>;

const CATALOG_PROVIDER: SchemaPatches = {
  providers: {
    properties: {
      catalog: { type: 'object', properties: {}, additionalProperties: true },
    },
  },
};

export const SCHEMA_PATCHES: Record<string, SchemaPatches> = {
  DomainClaim: CATALOG_PROVIDER,
  SystemClaim: CATALOG_PROVIDER,
  OrgSettingsClaim: {
    'providers.github.actions_variables': {
      'x-fs-forge-unique-item-property': 'name',
    },
    'providers.github.org': { description: 'GitHub organization name' },
    'providers.github.billing_email': {
      description: 'Billing email for the organization',
    },
    'providers.github.company': { description: 'Company name' },
    'providers.github.blog': { description: 'Blog URL' },
    'providers.github.email': { description: 'Contact email' },
    'providers.github.twitter_username': { description: 'Twitter username' },
    'providers.github.location': { description: 'Organization location' },
    'providers.github.description': { description: 'Organization description' },
    'providers.github.has_organization_projects': {
      description: 'Whether organization projects are enabled',
    },
    'providers.github.has_repository_projects': {
      description: 'Whether repository projects are enabled',
    },
    'providers.github.default_repository_permission': {
      description: 'Default permission for new repositories',
    },
    'providers.github.members_can_create_repositories': {
      description: 'Whether members can create repositories',
    },
    'providers.github.members_can_create_public_repositories': {
      description: 'Whether members can create public repositories',
    },
    'providers.github.members_can_create_private_repositories': {
      description: 'Whether members can create private repositories',
    },
    'providers.github.members_can_create_internal_repositories': {
      description: 'Whether members can create internal repositories',
    },
    'providers.github.members_can_create_pages': {
      description: 'Whether members can create pages',
    },
    'providers.github.members_can_create_public_pages': {
      description: 'Whether members can create public pages',
    },
    'providers.github.members_can_create_private_pages': {
      description: 'Whether members can create private pages',
    },
    'providers.github.members_can_fork_private_repositories': {
      description: 'Whether members can fork private repositories',
    },
    'providers.github.web_commit_signoff_required': {
      description: 'Whether web commit signoff is required',
    },
    'providers.github.advanced_security_enabled_for_new_repositories': {
      description: 'Whether advanced security is enabled for new repositories',
    },
    'providers.github.dependabot_alerts_enabled_for_new_repositories': {
      description: 'Whether Dependabot alerts are enabled for new repositories',
    },
    'providers.github.dependabot_security_updates_enabled_for_new_repositories':
      {
        description:
          'Whether Dependabot security updates are enabled for new repositories',
      },
    'providers.github.dependency_graph_enabled_for_new_repositories': {
      description:
        'Whether the dependency graph is enabled for new repositories',
    },
    'providers.github.secret_scanning_enabled_for_new_repositories': {
      description: 'Whether secret scanning is enabled for new repositories',
    },
    'providers.github.secret_scanning_push_protection_enabled_for_new_repositories':
      {
        description:
          'Whether secret scanning push protection is enabled for new repositories',
      },
  },
  ComponentClaim: {
    'providers.github.org': {
      description:
        'GitHub organization where the component repository is created; different from --org, the claims-repo organization.',
    },
  },
  GroupClaim: {
    'providers.github.org': {
      description:
        'GitHub organization where the Team is created; different from --org, the claims-repo organization.',
    },
  },
  OrgWebhookClaim: {
    'providers.github.orgName': { description: 'Organization name on GitHub' },
  },
  UserClaim: {
    'providers.github.org': {
      description:
        'GitHub organization whose membership is managed; different from --org, the claims-repo organization.',
    },
  },
};

/**
 * Schema paths that stay valid in a claim but get no create flag. A path hides
 * itself and everything below it.
 */
export const HIDDEN_FLAGS: Record<string, readonly string[]> = {
  ArgoDeployClaim: ['providers.argocd.json'],
  GroupClaim: ['providers.github.tfStateKey', 'providers.github.sync'],
  OrgWebhookClaim: ['providers.github.tfStateKey'],
  TFWorkspaceClaim: [
    'providers.terraform.tfStateKey',
    'providers.terraform.files',
    'providers.terraform.sync.json',
    'providers.terraform.variants',
  ],
  UserClaim: ['providers.github.tfStateKey', 'providers.github.sync'],
};

export function isHiddenFlag(kind: string, path: string): boolean {
  return (HIDDEN_FLAGS[kind] ?? []).some(
    (hidden) => path === hidden || path.startsWith(`${hidden}.`),
  );
}
