import root from './root.schema';
import CommonMeta from './common-meta.schema';
import GroupClaim from './group.schema';
import UserClaim from './user.schema';
import ComponentClaim from './component.schema';
import SystemClaim from './system.schema';
import DomainClaim from './domain.schema';
import TFWorkspaceClaim from './tfworkspace.schema';
import ArgoDeployClaim from './argodeploy.schema';
import SecretsClaim from './secrets.schema';
import OrgWebhookClaim from './orgwebhook.schema';
import OrgSettingsClaim from './orgsettings.schema';

import { GithubSchemas } from '../../github';
import { TerraformSchemas } from '../../tfworkspaces';
import { ArgoCDSchemas } from '../../argocd';
import { SecretsSchemas } from '../../external-secrets';

const schemas = {
  root,

  schemas: [
    CommonMeta,

    GroupClaim,

    UserClaim,

    ComponentClaim,

    SystemClaim,

    DomainClaim,

    TFWorkspaceClaim,

    ArgoDeployClaim,

    GithubSchemas,

    TerraformSchemas,

    ArgoCDSchemas,

    SecretsSchemas,

    SecretsClaim,

    OrgWebhookClaim,

    OrgSettingsClaim,
  ],
};

export default schemas;
