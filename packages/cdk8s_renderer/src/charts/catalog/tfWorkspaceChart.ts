import { TFWorkspace } from '../../claims/tfworkspaces/tfworkspace';
import { BaseCatalogChart } from './base';
import { ApiObject, GroupVersionKind } from 'cdk8s';
import common from 'catalog_common';

function findTfWorspaceDependencies(values: any): string[] {
  const matches: string[] = [];

  function helper(o: any) {
    for (const key in o) {
      switch (typeof o[key]) {
        case 'object':
          helper(o[key]);

          break;
        case 'string':
          for (const match of o[key].matchAll(
            common.types.regex.TFWorkspaceRefRegex,
          )) {
            const [_, claimName] = match;
            matches.push(`resource:${claimName}`);
          }

          break;
      }
    }
  }

  helper(values);

  return [...new Set(matches)];
}

export class CatalogTFWorkspaceChart extends BaseCatalogChart {
  template() {
    const claim: TFWorkspace = this.get('claim');

    const dependencies = findTfWorspaceDependencies(
      claim.providers.terraform.values,
    );

    const uniqueDependencies: string[] = [...new Set(dependencies)];

    return {
      apiVersion: 'backstage.io/v1alpha1',

      kind: 'Resource',

      metadata: {
        name: common.generic.normalizeName(claim.name),

        title: claim.name,

        annotations: claim.annotations || {},
      },

      spec: {
        type: claim.resourceType || 'tfresource',

        owner: claim.owner || 'nobody',

        system: claim.system,

        values: claim.providers.terraform,

        dependsOn: uniqueDependencies,
      },
    };
  }

  instanceApiObject(template: any): ApiObject {
    return new ApiObject(
      this,

      `${template.kind}-${template.metadata.name}`,

      template,
    );
  }

  gvk(): GroupVersionKind {
    return {
      kind: 'Resource',

      apiVersion: 'v1alpha1',
    };
  }
}
