import {
  AllowedProviders,
  configureProvider,
  reconfigureProvider,
  setPath,
  setRenamesEnabled,
} from '../config';
import common from 'catalog_common';

export function getAffectedWetRepository(
  providers: string[],
  wetRepositoriesConfig: any,
  kind: any,
) {
  for (const provider of providers) {
    if (kind in wetRepositoriesConfig.states[provider].crKinds) {
      return wetRepositoriesConfig.states[provider];
    }
  }

  return false;
}

export function configurePathsForRendering() {
  const configPath = '/tmp/defaults';

  createInitializers(configPath);

  createExpanders(configPath);

  try {
    configureProvider(AllowedProviders.all);
  } catch (err) {
    // Only the already-configured case is expected here; any other
    // configuration error must surface instead of being silently hidden.
    if (
      !(err instanceof Error) ||
      !err.message.includes('Provider already configured')
    ) {
      throw err;
    }
    reconfigureProvider(AllowedProviders.all);
  }

  setPath('initializers', configPath);

  setPath('crs', '/tmp/resources_from_main_branch');

  setPath('globals', configPath);

  setRenamesEnabled(false);
}

function createInitializers(path: string) {
  common.io.writeYamlFile(
    'defaults_github_group.yaml',

    {
      name: 'group_base',

      apiVersion: 'firestartr.dev/v1',

      kind: 'FirestartrGithubGroup',

      defaultValues: {
        org: 'potatoide-dev',
      },
    },

    path,
  );

  common.io.writeYamlFile(
    'defaults_github_repository.yaml',

    {
      name: 'repo_base',

      apiVersion: 'firestartr.dev/v1',

      kind: 'GithubRepositoryClaim',

      defaultValues: {
        firestartr: {
          technology: {
            stack: 'node',
          },
        },

        repo: {
          allowAutoMerge: true,

          codeowners: 'blah',

          allowMergeCommit: true,

          allowSquashMerge: true,

          allowRebaseMerge: true,

          deleteBranchOnMerge: true,

          autoInit: true,

          archiveOnDestroy: true,

          allowUpdateBranch: true,

          hasIssues: true,
        },
      },
    },

    path,
  );

  common.io.writeYamlFile(
    'defaults_technology.yaml',

    {
      name: 'technologies',

      apiVersion: 'firestartr.dev/v1',

      kind: 'FirestartrGithubRepository',

      defaultValues: {
        stack: 'node',

        version: '20',
      },
    },

    path,
  );
}

function createExpanders(path: string) {
  common.io.writeYamlFile(
    'expander_branch_strategies.yml',

    {
      name: 'branchStrategies',

      apiVersion: 'firestartr.dev/v1',

      kind: 'GithubRepositoryClaim',

      expanderValues: {
        strategies: [
          {
            name: 'trunkBasedDevelopment',

            values: {
              defaultBranch: 'main',

              branchProtections: [
                {
                  branch: 'main',

                  statusChecks: ['statuscheck1', 'statuscheck2'],

                  requiredReviewersCount: 2,

                  requiredCodeownersReviewers: false,

                  enforceAdmins: true,

                  requireSignedCommits: true,

                  requireConversationResolution: false,
                },
              ],
            },
          },
        ],
      },
    },

    path,
  );
}
