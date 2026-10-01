import { ApiObject, GroupVersionKind } from 'cdk8s';
import { FeatureRepoChart } from './featureRepoChart';
import {
  Permission,
  Var,
  NamedVars,
  VarsConfiguration,
  RepoSecret,
  RepoSecrets,
  RepoSecretsConfiguration,
  CollaboratorPermission,
  createCodeOwnersData,
  createPermissionFor,
  isRepoSecretRef,
} from '../../utils/repositoryClaimUtils';
import {
  FirestartrGithubRepository,
  FirestartrGithubRepositoryProps,
  FirestartrGithubRepositorySpecPages,
} from '../../../imports/firestartr.dev';
import { IGithubRepositoryClaim } from '../../claims/github/repository';
import { IGithubRepositoryFeatureClaim } from '../../claims/github/repositoryFeature';
import { IUnitializedStateKey } from '../../claims/base';
import { IRepositoryPage } from '../../claims/github/pages';
import common from 'catalog_common';
import { BaseGithubChart } from './base';

import RepoSecretsSectionChart from './RepoSecretsSectionChart';

import log from '../../logger';

function normalizePages(
  pages: IRepositoryPage | undefined,
): FirestartrGithubRepositorySpecPages | undefined {
  if (!pages) return undefined;
  return {
    cname: pages.cname,
    public: pages.public,
    httpsEnforced: pages.https_enforced,
    source: pages.source,
    buildType: pages.buildType,
  };
}

export class GithubRepositoryChart extends BaseGithubChart {
  template(): FirestartrGithubRepositoryProps | IUnitializedStateKey {
    const claim: IGithubRepositoryClaim = this.get('claim');
    const firestartrId: any = this.get('firestartrId');
    const crs: any = this.get('previousCRs');

    const actions = {
      oidc: {
        useDefault: claim.providers.github?.actions?.oidc?.useDefault,
        includeClaimKeys:
          claim.providers.github?.actions?.oidc?.includeClaimKeys ?? [],
      },
    };

    let crTemplate: FirestartrGithubRepositoryProps | IUnitializedStateKey = {
      metadata: {
        name: claim.providers.github.name,
        annotations: {
          [common.generic.getFirestartrAnnotation('branchStrategy')]:
            claim.providers.github.branchStrategy.name,
        },
      },
      spec: {
        org: claim.providers.github.org,
        firestartr: {
          tfStateKey: firestartrId || '',
          technology: claim.providers.github.technology,
        },
        repo: {
          description: claim.providers.github.description,
          allowMergeCommit: claim.providers.github.allowMergeCommit,
          allowSquashMerge: claim.providers.github.allowSquashMerge,
          allowRebaseMerge: claim.providers.github.allowRebaseMerge,
          allowAutoMerge: claim.providers.github.allowAutoMerge,
          deleteBranchOnMerge: claim.providers.github.deleteBranchOnMerge,
          autoInit: claim.providers.github.autoInit,
          archiveOnDestroy: claim.providers.github.archiveOnDestroy,
          allowUpdateBranch: claim.providers.github.allowUpdateBranch,
          hasIssues: claim.providers.github.hasIssues,
          hasWiki: claim.providers.github.hasWiki,
          ...(claim.providers.github.hasDiscussions !== undefined && {
            hasDiscussions: claim.providers.github.hasDiscussions,
          }),
          visibility: claim.providers.github.visibility,
          defaultBranch: claim.providers.github?.branchStrategy?.defaultBranch,
          codeowners: createCodeOwnersData(claim, undefined, crs),
          additionalBranches: claim.providers.github.additionalBranches || [],
          labels: claim.providers.github.labels || [],
          topics: claim.providers.github.topics || [],
        },
        actions,
        permissions: this.createPermissions(claim, crs),
        vars: this.createVars(claim),
        pages: normalizePages(claim.providers.github.pages),
        branchProtections: [],
        writeConnectionSecretToRef: {
          name: `firestartrgithubrepository-${claim.name}-outputs`.toLowerCase(),
          outputs: [
            { key: 'id' },
            { key: 'nodeId' },
            { key: 'fullName' },
            { key: 'htmlUrl' },
            { key: 'sshCloneUrl' },
            { key: 'primaryLanguage' },
          ],
        },
      },
    };

    // We do this to remove undefined variables from the template
    crTemplate = JSON.parse(JSON.stringify(crTemplate, null, 2));

    return crTemplate;
  }

  async render() {
    await super.render();

    await this.postRenderFeatures(this.get('rendered-cr'));

    await this.postRenderSecretsSection(this.get('rendered-cr'));

    return this;
  }

  gvk(): GroupVersionKind {
    return FirestartrGithubRepository.GVK;
  }

  async postRenderFeatures(cr: any) {
    const featuresPatches: any[] = this.get('patches').filter((patch: any) =>
      patch.identify().match(/^feature\//),
    );

    const features: {
      claim: { kind: string; name: string };
      chart: ApiObject;
    }[] = [];

    for (const featurePatch of featuresPatches) {
      const featureClaim: IGithubRepositoryFeatureClaim =
        await featurePatch.post(cr);

      const renderedFeature = await (
        await new FeatureRepoChart(
          this,

          `${featureClaim.name}-feature`,

          cr.spec.firestartr.tfStateKey,

          featureClaim,

          [],

          cr,
        ).render()
      ).postRenderer([]);

      features.push({
        claim: {
          kind: featureClaim.kind,

          name: featureClaim.name,
        },

        chart: renderedFeature,
      });
    }

    this.set(
      'features',

      features,
    );
  }

  async postRenderSecretsSection(cr: any) {
    // we always render the secretsSection
    // even if it is empty because we don't have a proper
    // way to know if there were secrets and now they have been
    // erased
    const secretsSectionChart = await (
      await new RepoSecretsSectionChart(
        this,

        'secrets-section',

        cr.spec.firestartr.tfStateKey,

        this.get('claim'),

        [],

        cr,
      ).render()
    ).postRenderer([]);

    this.set('secrets_section', {
      claim: {
        kind: secretsSectionChart.kind,
        name: secretsSectionChart.name,
      },

      chart: secretsSectionChart,
    });
  }

  instanceApiObject(template: any): ApiObject {
    return new FirestartrGithubRepository(
      this,
      template.metadata.name,
      template,
    );
  }

  /**
   * @description This method creates the permissions data for the repository
   * @param claim
   * @returns Permission[]
   */
  private createPermissions(
    claim: any,
    crs?: any,
  ): (Permission | CollaboratorPermission)[] {
    const permissions: (Permission | CollaboratorPermission)[] = [];

    const orgPermissions: 'none' | 'view' | 'contribute' =
      claim.providers.github.orgPermissions;

    if (claim.owner)
      permissions.push(createPermissionFor(claim.owner, 'admin', crs));

    if (claim.platformOwner)
      permissions.push(createPermissionFor(claim.platformOwner, 'admin', crs));

    if (claim.maintainedBy)
      for (const maintainer of claim.maintainedBy)
        permissions.push(createPermissionFor(maintainer, 'maintain', crs));

    switch (orgPermissions) {
      case 'view':
        permissions.push(
          createPermissionFor(
            `group:${claim.providers.github.org}-all`,
            'pull',
            crs,
          ),
        );
        break;
      case 'contribute':
        permissions.push(
          createPermissionFor(
            `group:${claim.providers.github.org}-all`,
            'maintain',
            crs,
          ),
        );
        break;
    }

    return permissions;
  }

  /**
   * @description This method creates the vars data for the repository
   * @param claim
   * @returns VarsConfiguration
   */
  private createVars(claim: any): VarsConfiguration {
    const vars: VarsConfiguration = {};

    const varsDefinition = claim.providers?.github?.vars;

    if (varsDefinition) {
      if (varsDefinition.actions) {
        vars.actions = this.formatVars(varsDefinition.actions);
      }
    }

    return vars;
  }

  formatVars(blockDefinition: any): NamedVars {
    return blockDefinition.map((varDef: any) => {
      if (isRepoSecretRef(varDef.value)) {
        const parts = varDef.value.split(':');

        return {
          name: varDef.name,
          ref: {
            kind: 'Secret',
            name: parts[2],
            key: parts[3],
          },
        };
      } else {
        return {
          name: varDef.name,
          value: varDef.value,
        };
      }
    });
  }

  extraCharts(): {
    claim: {
      kind: string;
      name: string;
    };
    chart: ApiObject;
  }[] {
    const charts = [this.get('secrets_section') ?? undefined];

    return charts
      .concat(this.get('features') ?? [])
      .filter((chart: any) => chart);
  }
}
