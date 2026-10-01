import { FirestartrTerraformWorkspaceSpecSource } from '../../../imports/firestartr.dev';
import { Workspace } from '../base/workspace';

export interface TerraformProviderAdditionalFile {
  source: string;

  destination: string;
}

export type TerraformProviderAdditionalFiles =
  TerraformProviderAdditionalFile[];

export interface TFWorkspace extends Workspace {
  kind: 'TFWorkspaceClaim';
  resourceType: string;
  version: string;
  providers: {
    terraform: {
      name: string;
      source:
        | FirestartrTerraformWorkspaceSpecSource.INLINE
        | FirestartrTerraformWorkspaceSpecSource.REMOTE;
      module: string;
      values: any;
      files: TerraformProviderAdditionalFiles;
      context: {
        providers: {
          name: string;
        }[];
        backend: {
          name: string;
        };
      };
    };
  };
}
