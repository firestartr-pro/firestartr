import apps from './apps.schema';
import platforms from './platforms.schema';
import dockerRegistries from './docker_registries.schema';
import helmRepositories from './helm_repositories.schema';
import stateAppsEnv from './state_apps_env.schema';

export { apps, platforms, dockerRegistries, helmRepositories, stateAppsEnv };

export const schemas = {
  apps,
  platforms,
  docker_registries: dockerRegistries,
  helm_repositories: helmRepositories,
};
