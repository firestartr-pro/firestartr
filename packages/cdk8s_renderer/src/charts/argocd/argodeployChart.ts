import { IArgoDeployClaim } from '../../claims/base/deploy';

import { BaseArgoCDChart } from './base';

import { ApiObject, GroupVersionKind } from 'cdk8s';

export class ArgoDeployChart extends BaseArgoCDChart {
  template() {
    const claim: IArgoDeployClaim = this.get('claim');

    return {
      apiVersion: 'argoproj.io/v1alpha1',

      kind: 'Application',

      metadata: this.templateMetadata(claim),

      spec: {
        project: claim.providers.argocd.project || 'default',

        sources: [this.templateChart(claim)].concat(this.templateValues(claim)),

        destination: this.templateDestination(claim),
      },
    };
  }

  templateMetadata(claim: any) {
    const { argocd } = claim.providers;

    return {
      name: argocd.name,
    };
  }

  templateChart(claim: any) {
    const { chart, values } = claim.providers.argocd;

    const template: any = {
      chart: chart.name,

      helm: {
        valueFiles: [],
      },
    };

    if (chart.oci) {
      template.helm['passCredentials'] = true;
    }

    const initial = 'abcdefghijklmnopqrstuvwxyz'.split('');

    for (const valueFile of values) {
      const initialForValueFile = initial.shift();

      for (const valueFilePath of valueFile.paths) {
        template.helm.valueFiles.push(
          `$values${initialForValueFile}/${valueFilePath.replace(/^\//, '')}`,
        );
      }
    }

    template.targetRevision = chart.version;

    template.repoURL = chart.source;

    return template;
  }

  templateValues(claim: any) {
    const { values } = claim.providers.argocd;

    const initial = 'abcdefghijklmnopqrstuvwxyz'.split('');

    return values.map((value: any) => {
      return {
        repoURL: value.source,

        targetRevision: value.revision,

        ref: `values${initial.shift()}`,
      };
    });
  }

  templateDestination(claim: any) {
    const { destination } = claim.providers.argocd;

    const template: any = {
      namespace: destination.namespace,
    };

    if ('server' in destination) {
      template['server'] = destination.server;
    } else {
      template['name'] = destination.name;
    }

    return template;
  }

  gvk(): GroupVersionKind {
    return {
      kind: 'ArgoDeployChart',

      apiVersion: 'v1',
    };
  }

  instanceApiObject(template: any): ApiObject {
    return new ApiObject(
      this,

      `${template.kind}-${template.metadata.name}`,

      template,
    );
  }
}
