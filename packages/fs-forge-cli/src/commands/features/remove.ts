import { Command, Flags } from '@oclif/core';

import {
  COMPONENT_ARG,
  FEATURE_TARGET_FLAGS,
  FEATURE_TARGET_RELATIONSHIP,
} from '../../utils/featureCommand.js';
import { runFeatureMutation } from '../../features/mutation.js';

export default class FeaturesRemove extends Command {
  static args = COMPONENT_ARG;
  static description = 'Remove a Feature reference from a ComponentClaim';
  static usage = '(COMPONENT | --file <path>) --name <feature>';
  static helpRelationships = [FEATURE_TARGET_RELATIONSHIP];
  static examples = [
    '<%= config.bin %> <%= command.id %> my-component --name logging --org my-org',
    '<%= config.bin %> <%= command.id %> --file component.yaml --name logging',
  ];
  static flags = {
    name: Flags.string({ description: 'Feature name', required: true }),
    ...FEATURE_TARGET_FLAGS,
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(FeaturesRemove);
    await runFeatureMutation(
      {
        operation: 'remove',
        component: args.component,
        file: flags.file,
        org: flags.org,
        commit: flags.commit,
        noWait: flags['no-wait'],
        json: flags.json,
        feature: { name: flags.name },
      },
      { schemasDir: `${this.config.root}/schemas` },
    );
  }
}
