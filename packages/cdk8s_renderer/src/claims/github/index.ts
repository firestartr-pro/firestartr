import GithubTeamClaimSchema from './group.schema';

import GithubUserClaimSchema from './user.schema';

import GithubComponentClaimSchema from './component.schema';

import GithubOrgWebhookClaimSchema from './orgwebhook.schema';

import GithubOrgSettingsClaimSchema from './orgsettings.schema';

import GithubComponentFeatureClaim from './feature.schema';

import GithubComponentSecretsAndVars from './component.secrets-vars.schema';

import GithubComponentClaimLabels from './component.labels.schema';

import GithubPagesSchema from './pages.schema';

export const GithubSchemas = [
  GithubTeamClaimSchema,

  GithubUserClaimSchema,

  GithubComponentFeatureClaim,

  GithubComponentClaimSchema,

  GithubOrgWebhookClaimSchema,

  GithubOrgSettingsClaimSchema,

  GithubComponentSecretsAndVars,

  GithubComponentClaimLabels,

  GithubPagesSchema,
];
