import { Command, Flags } from '@oclif/core';

import {
  COMPONENT_ARG,
  FEATURE_TARGET_FLAGS,
  FEATURE_TARGET_RELATIONSHIP,
} from '../../utils/featureCommand.js';
import {
  loadComponentTarget,
  writeAndPublishClaim,
} from '../../utils/featureClaims.js';
import { mutateFeatureReference } from '../../utils/features.js';
import { setSchemasDir, validateClaim } from '../../utils/ajvValidation.js';
import { ClaimsClient } from '../../claims/client.js';
import { requireOrg } from '../../mutations/support.js';
import { waitForDispatch } from '../../utils/waitForDispatch.js';

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
    const target = await loadComponentTarget({
      component: args.component,
      file: flags.file,
      org: flags.org,
      commit: flags.commit,
    });
    const claim = mutateFeatureReference(target.claim, 'remove', {
      name: flags.name,
    });
    setSchemasDir(`${this.config.root}/schemas`);
    const validation = await validateClaim(claim, 'ComponentClaim');
    if (!validation.valid) this.error(validation.errors.join('\n'));

    const result = await writeAndPublishClaim(target, claim, flags.json);
    if (result) {
      try {
        await waitForDispatch(new ClaimsClient(requireOrg(flags.org)), result, {
          noWait: flags['no-wait'],
          claimType: 'ComponentClaim',
          claimName: target.name,
          label: 'Provisioning',
        });
      } catch (error) {
        this.error(error instanceof Error ? error.message : String(error));
      }
    }
  }
}
