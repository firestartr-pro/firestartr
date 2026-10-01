import { schema as UserClaimSchema } from './user';
import { schema as GroupClaimSchema } from './group';
import { schema as ComponentClaimSchema } from './component';
import { schema as SystemClaimSchema } from './system';
import { schema as DomainClaimSchema } from './domain';
import { schema as TFWorkspaceClaimSchema } from './workspace';
import { schema as ArgoDeployClaimSchema } from './deploy';
import { schema as OrgWebhookClaimSchema } from './orgWebhook';
import { schema as OrgSettingsClaimSchema } from './orgSettings';
import { schema as SecretsClaimSchema } from './secrets';
/**
 * All Claims should implement this interface
 */
export interface IClaim {
  kind: string;
  version: string;
  name: string;
  annotations?: {
    [key: string]: string;
  };
}

export type IClaimWithFeatures = IClaim & IClaimInstalledFeatures;

export interface IClaimInstalledFeatures {
  features: IClaimInstalledFeature[];
}

export interface IClaimInstalledFeature {
  name: string;
  version: string;
  args?: {
    installOnBranch: string;
  };
}
export interface IUnitializedStateKey {
  spec: {
    firestartr: {
      tfStateKey: string | null;
    };
  };
}

export default {
  UserClaimSchema,
  GroupClaimSchema,
  ComponentClaimSchema,
  SystemClaimSchema,
  DomainClaimSchema,
  TFWorkspaceClaimSchema,
  ArgoDeployClaimSchema,
  OrgWebhookClaimSchema,
  OrgSettingsClaimSchema,
  SecretsClaimSchema,
};
