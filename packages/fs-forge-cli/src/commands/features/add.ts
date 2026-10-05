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
  mutateFeatureReference,
} from '../../utils/features.js';
import { setSchemasDir, validateClaim } from '../../utils/ajvValidation.js';
import { validateFeatureArgs } from '../../utils/featureSchema.js';
import { waitForDispatch } from '../../utils/waitForDispatch.js';

export default class FeaturesAdd extends FeatureSchemaCommand {
  static args = COMPONENT_ARG;
  static description =
    'Add a Feature reference to a ComponentClaim. Pass --name <feature> with --help to load schema-derived args.* flags.';
  static usage =
    '(COMPONENT | --file <path>) --name <feature> (--version <version> | --ref <ref>)';
  static helpRelationships = [FEATURE_TARGET_RELATIONSHIP];
  static examples = [
    '<%= config.bin %> <%= command.id %> my-component --name logging --version 1.0.0 --org my-org',
    '<%= config.bin %> <%= command.id %> --file component.yaml --name logging --ref main',
  ];
  static flags = {
    ...FEATURE_SCHEMA_FLAGS,
    version: {
      ...FEATURE_SCHEMA_FLAGS.version,
      exactlyOne: ['version', 'ref'],
    },
    ...FEATURE_TARGET_FLAGS,
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(FeaturesAdd);
    if (Boolean(flags.version) === Boolean(flags.ref)) {
      this.error('Provide exactly one of --version or --ref');
    }
    if (!this.featureSchema) this.error('Unable to resolve Feature schema');

    const target = await loadComponentTarget({
      component: args.component,
      file: flags.file,
      org: flags.org,
      commit: flags.commit,
    });
    const feature = buildFeatureReference(flags as Record<string, unknown>, [
      ...FEATURE_REFERENCE_SPECS,
      ...this.featureSpecs,
    ]);
    const claim = mutateFeatureReference(target.claim, 'add', feature);
    const argsValidation = validateFeatureArgs(
      this.featureSchema,
      feature.args ?? {},
    );
    if (!argsValidation.valid) this.error(argsValidation.errors.join('\n'));

    setSchemasDir(`${this.config.root}/schemas`);
    const claimValidation = await validateClaim(claim, 'ComponentClaim');
    if (!claimValidation.valid) this.error(claimValidation.errors.join('\n'));

    const result = await writeAndPublishClaim(target, claim, flags.json);
    if (result) {
      try {
        await waitForDispatch(
          result.repo.api,
          result.repo.ref,
          result.dispatch,
          {
            noWait: flags['no-wait'],
            claimType: 'ComponentClaim',
            claimName: target.name,
            label: 'Provisioning',
          },
        );
      } catch (error) {
        this.error(error instanceof Error ? error.message : String(error));
      }
    }
  }
}
