import apps from './apps.schema';
import platforms from './platforms.schema';
import dockerRegistries from './docker_registries.schema';
import helmRepositories from './helm_repositories.schema';

export { apps, platforms, dockerRegistries, helmRepositories };

export const schemas = {
  apps,
  platforms,
  docker_registries: dockerRegistries,
  helm_repositories: helmRepositories,
};
