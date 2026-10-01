import { CommandLineOptions } from 'command-line-args';
import { Subcommand } from '../types';
import { runScaffolder } from 'scaffolder';
import common from 'catalog_common';

export const scaffoldSubcommand: Subcommand = {
  description: 'Sync scafoldings in the catalog',
  requiredEnv: [
    common.types.envVars.token,
    common.types.envVars.tokenPrefapp,
    common.types.envVars.org,
    common.types.envVars.catalogScaffoldings,
  ],
  subparameters: [{ name: 'sync', alias: 's', type: Boolean }],
  run: async (options: CommandLineOptions) => {
    await runScaffolder(options);
  },
};
