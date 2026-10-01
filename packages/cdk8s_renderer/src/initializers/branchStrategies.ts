import { InitializerPatches } from './base';
import Ajv from 'ajv/dist/2020';
import common from 'catalog_common';
import { ICustomResourcePatch } from '../patches';

export class BranchStrategiesInitializer extends InitializerPatches {
  protected static fileName?: string = 'branch_strategies';

  applicableProviders = ['github'];

  constructor(data?: any) {
    super(data);

    if (!data?.virtual) {
      const invalidBranchStrategies: any[] =
        data?.defaultValues?.strategies.filter((strat: any) =>
          ['none', 'custom'].includes(strat.name),
        );

      if (invalidBranchStrategies.length > 0)
        throw new Error(
          'Branch strategy files cannot contain branch strategies ' +
            "named 'none' or 'custom'",
        );
    }
  }

  async __validate(schema: any) {
    const ajv: Ajv = new Ajv({
      allErrors: true,
    });

    const validate = ajv.compile(schema);

    return validate(this.data.values);
  }

  async __patches(
    claim: any,
    previousCR: any,
  ): Promise<ICustomResourcePatch[]> {
    let strategyInitializers: any = false;

    if (!['none'].includes(claim.providers.github.branchStrategy.name)) {
      strategyInitializers = this.data.values.strategies.find(
        (strategy: any) =>
          strategy.name === claim.providers.github.branchStrategy.name,
      );

      if (
        !strategyInitializers &&
        claim.providers.github.branchStrategy.name !== 'custom'
      )
        throw new Error(
          `No branch strategy found for ${claim.providers.github.branchStrategy.name}`,
        );
    }

    return [
      {
        validate(cr: any) {
          return (
            !strategyInitializers ||
            (cr.spec.repo.defaultBranch ===
              strategyInitializers.values.defaultBranch &&
              cr.spec.branchProtections ===
                strategyInitializers.values.branchProtections)
          );
        },

        apply(cr: any) {
          if (strategyInitializers) {
            cr.spec.repo.defaultBranch =
              strategyInitializers.values.defaultBranch;

            cr.spec.branchProtections =
              strategyInitializers.values.branchProtections;
          } else if (
            !strategyInitializers &&
            claim.providers.github.branchStrategy.name === 'custom'
          ) {
            cr.spec.repo.defaultBranch = claim.providers.github.defaultBranch;

            cr.spec.branchProtections = previousCR.spec.branchProtections;
          } else {
            cr.spec.repo.defaultBranch = claim.providers.github.defaultBranch;

            cr.spec.branchProtections = [];
          }

          cr.spec.branchProtections = cr.spec?.branchProtections ?? [];

          delete cr.metadata.annotations[
            common.generic.getFirestartrAnnotation('branchStrategy')
          ];

          return cr;
        },

        identify() {
          return 'initializers/BranchStrategies';
        },
      },
    ];
  }
}
