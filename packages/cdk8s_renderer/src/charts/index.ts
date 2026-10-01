import {
  GithubGroupChart,
  GithubMembershipChart,
  GithubRepositoryChart,
  GithubOrgWebhookChart,
  GithubOrgSettingsChart,
  GithubOrgVariableSectionChart,
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
  CatalogApiChart,
  GithubGroupChart,
  GithubMembershipChart,
  GithubRepositoryChart,
  TFWorkspaceChart,
  ArgoDeployChart,
  SecretsChart,
  GithubOrgWebhookChart,
  GithubOrgSettingsChart,
  GithubOrgVariableSectionChart,
};
