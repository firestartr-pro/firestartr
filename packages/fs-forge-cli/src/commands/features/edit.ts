import {
  COMPONENT_ARG,
  FEATURE_REFERENCE_SPECS,
  FEATURE_SCHEMA_FLAGS,
  FEATURE_TARGET_FLAGS,
  FEATURE_TARGET_RELATIONSHIP,
  FeatureSchemaCommand,
} from '../../utils/featureCommand.js';
import {
  loadComponentTarget,
  writeAndPublishClaim,
} from '../../utils/featureClaims.js';
import {
  buildFeatureReference,
  getFeatureReferences,
  mutateFeatureReference,
} from '../../utils/features.js';
import { setSchemasDir, validateClaim } from '../../utils/ajvValidation.js';
import { validateFeatureArgs } from '../../utils/featureSchema.js';
import { ClaimsClient } from '../../claims/client.js';
import { requireOrg } from '../../mutations/support.js';
import { waitForDispatch } from '../../utils/waitForDispatch.js';

export default class FeaturesEdit extends FeatureSchemaCommand {
  protected applyFeatureDefaults = false;

  static args = COMPONENT_ARG;
  static description =
    'Edit a Feature reference on a ComponentClaim. Pass --name <feature> with --help to load schema-derived args.* flags. Omit --version and --ref to preserve the current pin.';
  static usage =
    '(COMPONENT | --file <path>) --name <feature> [--version <version> | --ref <ref>]';
  static helpRelationships = [FEATURE_TARGET_RELATIONSHIP];
  static examples = [
    '<%= config.bin %> <%= command.id %> my-component --name logging --org my-org',
    '<%= config.bin %> <%= command.id %> --file component.yaml --name logging --ref main',
  ];
  static flags = {
    ...FEATURE_SCHEMA_FLAGS,
    ...FEATURE_TARGET_FLAGS,
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(FeaturesEdit);
    if (!this.featureSchema) this.error('Unable to resolve Feature schema');

    const target = await loadComponentTarget({
      component: args.component,
      file: flags.file,
      org: flags.org,
      commit: flags.commit,
    });
    const existing = getFeatureReferences(target.claim).find(
      ({ name }) => name === flags.name,
    );
    if (!existing) this.error(`Feature not found: ${flags.name}`);

    const feature = buildFeatureReference(
      flags as Record<string, unknown>,
      [...FEATURE_REFERENCE_SPECS, ...this.featureSpecs],
      existing,
    );
    const argsValidation = validateFeatureArgs(
      this.featureSchema,
      feature.args ?? {},
    );
    if (!argsValidation.valid) this.error(argsValidation.errors.join('\n'));

    const claim = mutateFeatureReference(target.claim, 'edit', feature);
    setSchemasDir(`${this.config.root}/schemas`);
    const claimValidation = await validateClaim(claim, 'ComponentClaim');
    if (!claimValidation.valid) this.error(claimValidation.errors.join('\n'));

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
