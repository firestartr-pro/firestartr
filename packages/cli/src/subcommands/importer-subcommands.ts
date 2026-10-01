import { CommandLineOptions } from 'command-line-args';
import { Subcommand } from '../types';
import { runImporter } from 'importer';

export const importSubcommand: Subcommand = {
  description: "Import organization's artifact(s) to a catalog",

  requiredEnv: [],

  subparameters: [
    { name: 'force', type: Boolean },

    { name: 'skipPlan', type: Boolean },

    { name: 'claims', type: String },

    { name: 'crs', type: String },

    { name: 'config', type: String },

    { name: 'claimsDefaults', type: String },

    { name: 'org', type: String },

    { name: 'filters', type: String, multiple: true, defaultValue: [] },

    { name: 'reImport', type: Boolean, defaultValue: false },
  ],

  run: async (options: CommandLineOptions) => {
    console.table(options);

    await runImporter(
      options.force,
      options.skipPlan,
      options.claims,
      options.crs,
      options.config,
      options.claimsDefaults,
      options.org,
      options.filters,
      undefined,
      options.reImport,
    );
  },
};
