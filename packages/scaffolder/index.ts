import { Scaffolder } from './src/scaffolder';
import catalog_common from 'catalog_common';

export async function runScaffolder(options: any) {
  const { sync } = options;

  if (sync) {
    const org = catalog_common.environment.getFromEnvironmentWithDefault(
      catalog_common.types.envVars.org,
    );

    const scaffolder = new Scaffolder(org);

    const scaffolderPath =
      catalog_common.environment.getFromEnvironmentWithDefault(
        catalog_common.types.envVars.catalogScaffoldings,
      );

    await scaffolder.syncSkeletons(scaffolderPath, org);
  }
}
