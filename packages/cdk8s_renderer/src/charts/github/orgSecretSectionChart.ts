import common from 'catalog_common';
import {
  FirestartrGithubOrganizationSecretSection,
  FirestartrGithubOrganizationSecretSectionProps,
} from '../../../imports/firestartr.dev';
import { IUnitializedStateKey } from '../../claims/base';
import { IGithubOrgSettingsClaim } from '../../claims/github/orgSettings';
import { ChartRenderError } from '../base';
import { BaseGithubChart } from './base';

export class GithubOrgSecretSectionChart extends BaseGithubChart {
  public template():
    FirestartrGithubOrganizationSecretSectionProps | IUnitializedStateKey {
    const claim: IGithubOrgSettingsClaim = this.get('claim');
    const firestartrId: string | null = this.get('firestartrId');
    const githubProvider = claim.providers.github;

    const orgSecrets = githubProvider.org_secrets || {};

    const renderSecrets = (section: string) => {
      const secrets = orgSecrets[section as keyof typeof orgSecrets];
      if (!Array.isArray(secrets)) return [];

      return secrets.map((secret) => {
        const parts = secret.value.split(':');
        const selectedRepositories = (secret.selected_repositories || []).map(
          (ref: string) => {
            const match = ref.match(/^component:(.+)$/);
            if (!match) {
              throw new ChartRenderError(
                'OrgSettingsClaim',
                claim.name,
                `Invalid component ref "${ref}" in selected_repositories. Expected format: component:<name>`,
              );
            }
            const componentName = match[1];
            const resolvedCr = this.refResolver(
              'ComponentClaim',
              componentName,
            );
            const org = resolvedCr?.spec?.org;
            const repoName =
              resolvedCr?.metadata?.annotations?.[
                'firestartr.dev/external-name'
              ] || resolvedCr?.metadata?.name?.replace(/-[0-9a-f-]{36}$/, '');
            if (!org || !repoName) {
              throw new ChartRenderError(
                'OrgSettingsClaim',
                claim.name,
                `Referenced component "${componentName}" has no GitHub provider configured`,
              );
            }
            return `${org}/${repoName}`;
          },
        );
        return {
          name: secret.name,
          ref: {
            kind: 'Secret',
            name: common.generic.normalizeName(parts[2]),
            key: parts[3],
          },
          visibility: secret.visibility || 'all',
          selectedRepositories,
        };
      });
    };

    const template = {
      metadata: {
        name: githubProvider.name,
      },
      spec: {
        org: githubProvider.org,
        secrets: {
          actions: renderSecrets('actions'),
          codespaces: renderSecrets('codespaces'),
          dependabot: renderSecrets('dependabot'),
        },
        firestartr: {
          tfStateKey: firestartrId,
        },
        writeConnectionSecretToRef: {
          name: `firestartrgithuborganizationsecretsection-${githubProvider.name}-secrets-outputs`.toLowerCase(),
          outputs: [
            { key: 'actions_secret_names' },
            { key: 'codespaces_secret_names' },
            { key: 'dependabot_secret_names' },
          ],
        },
      },
    };

    return JSON.parse(JSON.stringify(template));
  }

  gvk() {
    return FirestartrGithubOrganizationSecretSection.GVK;
  }

  instanceApiObject(template: any): FirestartrGithubOrganizationSecretSection {
    return new FirestartrGithubOrganizationSecretSection(
      this,
      template.metadata.name,
      template,
    );
  }
}
