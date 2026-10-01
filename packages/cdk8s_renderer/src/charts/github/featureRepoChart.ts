import { IGithubRepositoryFeatureClaim } from '../../claims/github/repositoryFeature';
import {
  FirestartrGithubRepositoryFeature,
  FirestartrGithubRepositoryFeatureProps,
  FirestartrGithubRepositoryFeatureSpecRepositoryTarget,
} from '../../../imports/firestartr.dev';
// import { resolveClaimRef } from '../../refresolver';
import { GroupVersionKind } from 'cdk8s';
import { BaseGithubChart } from './base';

export class FeatureRepoChart extends BaseGithubChart {
  constructor(
    scope: any,

    chartId: string,

    firestartrId: string | null,

    claim: any,

    patches: any[] = [],

    cr = null,
  ) {
    super(scope, chartId, firestartrId, claim, patches);

    this.set('repoCr', cr);
  }

  template(): FirestartrGithubRepositoryFeatureProps {
    const claim: any = this.get('claim') as IGithubRepositoryFeatureClaim;

    const repositoryTarget: FirestartrGithubRepositoryFeatureSpecRepositoryTarget =
      this.resolveRepositoryTarget();

    const annotations: Record<string, string> = {
      'firestartr.dev/external-name': claim.name,
      'firestartr.dev/feature-name': claim.feature.name,
    };

    if (claim.feature.sha) {
      annotations['firestartr.dev/feature-git-sha'] = claim.feature.sha;
    }
    if (claim.feature.tags?.length) {
      annotations['firestartr.dev/feature-git-tags'] = JSON.stringify(
        claim.feature.tags,
      );
    }
    if (claim.feature.url) {
      annotations['firestartr.dev/feature-url'] = claim.feature.url;
    }
    if (claim.feature.ref) {
      annotations['firestartr.dev/feature-ref'] = claim.feature.ref;
    }
    if (claim.feature.repo) {
      annotations['firestartr.dev/feature-repo'] = claim.feature.repo;
    }

    const cr = {
      metadata: {
        name: claim.name,

        annotations,
      },

      spec: {
        context: claim.context,

        type: claim.name,

        version: claim.feature.version,

        org: claim.org,

        repositoryTarget,

        files: claim.files.map((file: any) => {
          if (file.targetBranch === '') delete file['targetBranch'];

          return {
            ...file,
          };
        }),

        firestartr: {
          tfStateKey: claim.firestartr.tfStateKey,
        },
      },
    };

    const repoAnnotations = this.getAnnotationsFromRepo(this.get('repoCr'), [
      'claim-ref',
      'revision',
      'sync-enabled',
      'sync-period',
    ]);

    cr.metadata.annotations = {
      ...cr.metadata.annotations,
      ...repoAnnotations,
    };

    // We do this to remove undefined variables from the template
    const crTemplate = JSON.parse(JSON.stringify(cr, null, 2));

    return crTemplate;
  }

  gvk(): GroupVersionKind {
    return FirestartrGithubRepositoryFeature.GVK;
  }

  private getAnnotationsFromRepo(repoCr: any, inheritedAnnotations: string[]) {
    const annotations: { [key: string]: string } = {};

    for (const annotation of inheritedAnnotations) {
      const fsAnnotation = `firestartr.dev/${annotation}`;
      if (fsAnnotation in repoCr.metadata.annotations) {
        annotations[fsAnnotation] = repoCr.metadata.annotations[fsAnnotation];
      }
    }

    return annotations;
  }

  private resolveRepositoryTarget() {
    const repositoryTarget: FirestartrGithubRepositoryFeatureSpecRepositoryTarget =
      {
        ref: {
          kind: 'FirestartrGithubRepository',

          name: this.get('repoCr').metadata.name,

          needsSecret: false,
        },

        branch: this.get('repoCr').spec.repo.defaultBranch,
      };

    return repositoryTarget;
  }

  instanceApiObject(template: any): FirestartrGithubRepositoryFeature {
    return new FirestartrGithubRepositoryFeature(
      this,

      `${template.metadata.name}-${template.spec.firestartr.tfStateKey}-feature`,

      template,
    );
  }
}
