import {
  GithubGroupChart,
  GithubMembershipChart,
  GithubRepositoryChart,
  GithubOrgWebhookChart,
  GithubOrgSettingsChart,
  GithubOrgRulesetChart,
  GithubOrgVariableSectionChart,
  GithubOrgSecretSectionChart,
} from './github';

import {
  CatalogComponentChart,
  CatalogDomainChart,
  CatalogGroupChart,
  CatalogSystemChart,
  CatalogUserChart,
  CatalogTFWorkspaceChart,
  CatalogArgoDeployChart,
  CatalogSecretsChart,
  CatalogOrgWebhookChart,
  CatalogOrgRulesetChart,
  CatalogApiChart,
} from './catalog';

import { TFWorkspaceChart } from './workspaces/tfworkspaceChart';
import { ArgoDeployChart } from './argocd/argodeployChart';
import { SecretsChart } from './secrets/secretsChart';

export default {
  CatalogComponentChart,
  CatalogDomainChart,
  CatalogGroupChart,
  CatalogSystemChart,
  CatalogUserChart,
  CatalogTFWorkspaceChart,
  CatalogArgoDeployChart,
  CatalogSecretsChart,
  CatalogOrgWebhookChart,
  CatalogOrgRulesetChart,
  CatalogApiChart,
  GithubGroupChart,
  GithubMembershipChart,
  GithubRepositoryChart,
  TFWorkspaceChart,
  ArgoDeployChart,
  SecretsChart,
  GithubOrgWebhookChart,
  GithubOrgSettingsChart,
  GithubOrgRulesetChart,
  GithubOrgVariableSectionChart,
  GithubOrgSecretSectionChart,
};
