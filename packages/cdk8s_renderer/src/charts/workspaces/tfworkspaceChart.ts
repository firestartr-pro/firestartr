import {
  FirestartrTerraformWorkspace,
  FirestartrTerraformWorkspaceProps,
} from '../../../imports/firestartr.dev';
import { IUnitializedStateKey } from '../../claims/base';
import { TFWorkspace } from '../../claims/tfworkspaces/tfworkspace';
import { BaseWorkspaceChart } from './base';

export class TFWorkspaceChart extends BaseWorkspaceChart {
  public template(): FirestartrTerraformWorkspaceProps | IUnitializedStateKey {
    const claim: TFWorkspace = this.get('claim');

    const firestartrId: string = this.get('firestartrId');

    const source: string =
      claim.providers.terraform.source.charAt(0).toUpperCase() +
      claim.providers.terraform.source.slice(1);

    if (!source || !['Remote', 'Inline'].includes(source))
      throw new Error('TFWorkspaceChart: source value is not valid');

    return {
      metadata: {
        name: claim.providers.terraform.name,
        ...(claim.annotations && Object.keys(claim.annotations).length > 0
          ? { annotations: claim.annotations }
          : {}),
      },

      spec: {
        firestartr: {
          tfStateKey: firestartrId || '',
        },

        module: claim.providers.terraform.module,

        source: source as any,

        values: this.buildValues(),

        context: this.buildFirestartrContext(),
      },
    };
  }

  gvk() {
    return FirestartrTerraformWorkspace.GVK;
  }

  instanceApiObject(template: any): FirestartrTerraformWorkspace {
    return new FirestartrTerraformWorkspace(
      this,

      template.metadata.name,

      template,
    );
  }

  buildFirestartrContext() {
    const claim = this.get('claim');

    const context: any = {};

    context['providers'] = [];

    if (
      claim.providers &&
      claim.providers.terraform &&
      claim.providers.terraform.context &&
      claim.providers.terraform.context.providers
    ) {
      for (const provider of claim.providers.terraform.context.providers) {
        context['providers'].push({
          ref: {
            kind: 'FirestartrProviderConfig',

            name: provider.name,
          },
        });
      }
    }

    if (
      claim.providers &&
      claim.providers.terraform &&
      claim.providers.terraform.context &&
      claim.providers.terraform.context.backend
    ) {
      context['backend'] = {
        ref: {
          kind: 'FirestartrProviderConfig',

          name: claim.providers.terraform.context.backend.name,
        },
      };
    }

    return context;
  }

  buildValues() {
    const values = this.get('claim').providers.terraform.values;

    if (!values) {
      return '{}';
    }

    return JSON.stringify(values);
  }
}
