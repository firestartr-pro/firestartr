import {
  COMPONENT_ARG,
  FEATURE_REFERENCE_SPECS,
  FEATURE_SCHEMA_FLAGS,
  FEATURE_TARGET_FLAGS,
  FEATURE_TARGET_RELATIONSHIP,
  FeatureSchemaCommand,
} from '../../utils/featureCommand.js';
import { runFeatureMutation } from '../../features/mutation.js';
import { buildFeatureReference } from '../../utils/features.js';

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

    const feature = buildFeatureReference(flags as Record<string, unknown>, [
      ...FEATURE_REFERENCE_SPECS,
      ...this.featureSpecs,
    ]);
    await runFeatureMutation(
      {
        operation: 'add',
        component: args.component,
        file: flags.file,
        org: flags.org,
        commit: flags.commit,
        noWait: flags['no-wait'],
        json: flags.json,
        feature,
        featureSchema: this.featureSchema,
      },
      { schemasDir: `${this.config.root}/schemas` },
    );
  }
}
