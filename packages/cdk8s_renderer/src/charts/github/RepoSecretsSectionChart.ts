import {
  FirestartrGithubRepositorySecretsSection,
  FirestartrGithubRepositorySecretsSectionProps,
  FirestartrGithubRepositorySecretsSectionSpecRepositoryTarget,
} from '../../../imports/firestartr.dev';
import { GroupVersionKind } from 'cdk8s';
import { BaseGithubChart } from './base';

export default class RepoSecretsSectionChart extends BaseGithubChart {
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

  template(): FirestartrGithubRepositorySecretsSectionProps {
    const claim: any = this.get('claim') as any;

    const repositoryTarget: FirestartrGithubRepositorySecretsSectionSpecRepositoryTarget =
      this.resolveRepositoryTarget();

    const github = claim.providers?.github ?? {};

    const cr = {
      metadata: {
        name: this.get('repoCr').metadata.name,

        annotations: {
          'firestartr.dev/external-name': claim.name,
        },
      },

      spec: {
        context: this.get('repoCr').spec?.context,

        org: claim.org,

        repositoryTarget,

        secrets: {
          actions: this.renderSecrets('actions', github),

          codespaces: this.renderSecrets('codespaces', github),

          dependabot: this.renderSecrets('dependabot', github),
        },

        firestartr: {
          tfStateKey: this.get('repoCr').spec.firestartr.tfStateKey,
        },
      },
    };

    const annotations = this.getAnnotationsFromRepo(this.get('repoCr'), [
      'claim-ref',
      'revision',
      'sync-enabled',
      'sync-period',
    ]);

    cr.metadata.annotations = {
      ...cr.metadata.annotations,
      ...annotations,
    };

    return cr;
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

  renderSecrets(section: string, githubProvider: any) {
    const secrets = [];

    if (githubProvider?.secrets?.[section]) {
      const secretsSection = githubProvider.secrets[section];

      for (const secret of secretsSection) {
        const parts = secret.value.split(':');

        secrets.push({
          name: secret.name,

          ref: {
            kind: 'Secret',

            name: parts[2],

            key: parts[3],
          },
        });
      }
    }

    return secrets;
  }

  gvk() {
    return FirestartrGithubRepositorySecretsSection.GVK;
  }

  instanceApiObject(template: any): FirestartrGithubRepositorySecretsSection {
    return new FirestartrGithubRepositorySecretsSection(
      this,

      `${template.metadata.name}-${template.spec.firestartr.tfStateKey}-secrets-section`,

      template,
    );
  }

  private resolveRepositoryTarget() {
    const repositoryTarget: FirestartrGithubRepositorySecretsSectionSpecRepositoryTarget =
      {
        ref: {
          kind: 'FirestartrGithubRepository',

          name: this.get('repoCr').metadata.name,

          needsSecret: false,
        },
      };

    return repositoryTarget;
  }
}
