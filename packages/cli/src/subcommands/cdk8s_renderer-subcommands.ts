import { CommandLineOptions } from 'command-line-args';
import { Subcommand } from '../types';
import renderer, { runRenderer, generateClaimsMap } from 'cdk8s_renderer';
export const cdk8s_rendererSubcommands: Subcommand = {
  description: 'CDK8S renderer subcommands',
  requiredEnv: [],
  subparameters: [
    /**
     * Command to activate main functionality
     */
    { name: 'render', alias: 'r', type: Boolean },
    { name: 'compare', type: Boolean },
    { name: 'render-plan', type: Boolean },
    { name: 'generate-claims-map', type: Boolean },

    /**
     * Specific parameters for render functionality
     */
    { name: 'globals', alias: 'g', type: String },
    { name: 'initializers', alias: 'i', type: String },
    { name: 'claims', alias: 'c', type: String },
    { name: 'excludePath', type: String, multiple: true, defaultValue: [] },
    { name: 'previousCRs', alias: 'p', type: String },
    { name: 'provider', type: String },
    { name: 'outputCatalogDir', type: String, defaultValue: '/tmp/.catalog' },
    {
      name: 'validateReferentialIntegrity',
      type: String,
      defaultValue: 'enabled',
    },
    {
      name: 'outputCrDir',
      alias: 'o',
      type: String,
      defaultValue: '/tmp/.resources',
    },
    { name: 'disableRenames', type: Boolean, defaultValue: false },
    { name: 'claimRefsList', type: String, defaultValue: '' },
    { name: 'claimFilesList', type: String, defaultValue: '' },

    /**
     * Repository URL for backstage.io/edit-url annotation
     */
    { name: 'repositoryUrl', type: String },

    /**
     * Default branch for backstage.io/edit-url annotation
     */
    { name: 'defaultBranch', type: String, defaultValue: 'main' },

    /**
     * Path where the claims defaults are located
     */
    { name: 'claimsDefaults', alias: 'd', type: String },

    /**
     * Specific parameters for compare functionality
     */
    { name: 'claimsFromMain', type: String },
    { name: 'wetReposConfig', type: String },
    { name: 'claimsFromPr', type: String },
    { name: 'outputComparer', type: String },

    /**
     * Specific parameters for render-plan functionality
     */
    { name: 'inputDir', type: String },
    { name: 'outputDir', type: String },
    { name: 'prLink', type: String },
    { name: 'sha', type: String },

    /**
     * Specific parameters for last-state and last-claim annotations
     */
    { name: 'lastStatePrLink', type: String },
    { name: 'lastClaimPrLink', type: String },
    { name: 'crLocation', type: String },

    /**
     * Specific parameters for claims-map generation
     */
    { name: 'claims-map-output', alias: 'm', type: String },
  ],

  run: async (options: CommandLineOptions) => {
    if (options['render']) {
      console.table(options);

      await runRenderer(
        options['globals'],
        options['initializers'],
        options['claims'],
        options['previousCRs'],
        options['claimsDefaults'],
        options['outputCatalogDir'],
        options['outputCrDir'],
        !options['disableRenames'],
        options['provider'],
        options['excludePath'],
        options['validateReferentialIntegrity'],
        options['claimRefsList'],
        options['claimFilesList'],
        options['repositoryUrl'],
        options['defaultBranch'],
      );
    } else if (options['compare']) {
      await renderer.runComparer(
        options['claimsFromMain'],
        options['claimsFromPr'],
        options['claimsDefaults'],
        options['wetReposConfig'],
        options['outputComparer'],
      );
    } else if (options['lastStatePrLink'] && options['lastClaimPrLink']) {
      await renderer.addLastStateAndLastClaimAnnotations(
        options['crLocation'],
        options['lastStatePrLink'],
        options['lastClaimPrLink'],
      );
    } else if (options['generate-claims-map']) {
      const claimsPath = options['claims'];
      const outputPath = options['claims-map-output'];
      if (!claimsPath || !outputPath) {
        throw new Error(
          '--claims and --claims-map-output are required with --generate-claims-map',
        );
      }
      await generateClaimsMap(claimsPath, outputPath, options['sha']);
    }
  },
};
