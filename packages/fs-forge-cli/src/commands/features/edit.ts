import {
  COMPONENT_ARG,
  FEATURE_SCHEMA_FLAGS,
  FEATURE_TARGET_FLAGS,
  FEATURE_TARGET_RELATIONSHIP,
  FeatureSchemaCommand,
} from '../../utils/featureCommand.js';
import { FEATURE_REFERENCE_SPECS } from '../../features/dynamicFlags.js';
import { runFeatureMutation } from '../../features/mutation.js';
import { buildFeatureReference } from '../../utils/features.js';

export default class FeaturesEdit extends FeatureSchemaCommand {
  static get applyFeatureDefaults(): boolean {
    return false;
  }

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

    const feature = buildFeatureReference(flags as Record<string, unknown>, [
      ...FEATURE_REFERENCE_SPECS,
      ...this.featureSpecs,
    ]);
    await runFeatureMutation(
      {
        operation: 'edit',
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
