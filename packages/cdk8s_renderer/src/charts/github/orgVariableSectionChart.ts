import {
  FirestartrGithubOrganizationVariableSection,
  FirestartrGithubOrganizationVariableSectionProps,
  FirestartrGithubOrganizationVariableSectionSpecActionsVariablesVisibility,
} from '../../../imports/firestartr.dev';
import { IUnitializedStateKey } from '../../claims/base';
import { IGithubOrgSettingsClaim } from '../../claims/github/orgSettings';
import { BaseGithubChart } from './base';
import { ChartRenderError } from '../base';

export class GithubOrgVariableSectionChart extends BaseGithubChart {
  public template():
    | FirestartrGithubOrganizationVariableSectionProps
    | IUnitializedStateKey {
    const claim: IGithubOrgSettingsClaim = this.get('claim');
    const firestartrId: string | null = this.get('firestartrId');
    const githubProvider = claim.providers.github;

    const actionsVariables = (githubProvider.actions_variables || []).map(
      (v) => {
        const entry: any = {
          name: v.name,
          value: v.value,
          visibility:
            v.visibility as FirestartrGithubOrganizationVariableSectionSpecActionsVariablesVisibility,
        };

        if (v.selected_repositories && v.selected_repositories.length > 0) {
          entry.selectedRepositories = v.selected_repositories.map((ref) => {
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
          });
        }

        return entry;
      },
    );

    const template = {
      metadata: {
        name: githubProvider.name,
      },
      spec: {
        org: githubProvider.org,
        actionsVariables,
        firestartr: {
          tfStateKey: firestartrId,
        },
        writeConnectionSecretToRef: {
          name: `firestartrgithuborganizationvariablesection-${githubProvider.name}-outputs`.toLowerCase(),
          outputs: [{ key: 'managed_variables' }, { key: 'variable_ids' }],
        },
      },
    };

    return JSON.parse(JSON.stringify(template));
  }

  gvk() {
    return FirestartrGithubOrganizationVariableSection.GVK;
  }

  instanceApiObject(
    template: any,
  ): FirestartrGithubOrganizationVariableSection {
    return new FirestartrGithubOrganizationVariableSection(
      this,
      template.metadata.name,
      template,
    );
  }
}
