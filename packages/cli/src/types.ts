import { OptionDefinition, CommandLineOptions } from 'command-line-args';

// Type for artifact's actions
export type ArtifactAction = {
  kind: string;
  name: string;
  updatedCatalogPath: string;
};

// Type for each subcommand
export type Subcommand = {
  description: string;
  requiredEnv: string[];
  subparameters: OptionDefinition[];
  run: (options: CommandLineOptions) => Promise<void>;
};

// Type for the subcommands definition
export type Subcommands = { [key: string]: Subcommand };
