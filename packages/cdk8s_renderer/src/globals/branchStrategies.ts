import { ICustomResourcePatch } from '../patches';
import { GlobalSection } from './base';
import common from 'catalog_common';

export class BranchStrategiesExpander extends GlobalSection {
  protected static fileName?: string = 'expander_branch_strategies';

  applicableProviders = ['github'];

  async __validate() {
    return true;
  }

  constructor(data: any) {
    super(data);

    if (data?.expanderValues) {
      this.data['values'] = data.expanderValues;
    }
  }

  async __patches(
    claim: any,
    previousCR: any,
  ): Promise<ICustomResourcePatch[]> {
    let strategyGlobals: any = false;

    if (
      !['none', 'custom'].includes(claim.providers.github.branchStrategy.name)
    ) {
      strategyGlobals = this.data.values.strategies.find(
        (strategy: any) =>
          strategy.name === claim.providers.github.branchStrategy.name,
      );

      if (!strategyGlobals)
        throw new Error(
          `No branch strategy global found for ${claim.providers.github.branchStrategy.name}`,
        );
    }

    return [
      {
        validate(cr: any) {
          return (
            !strategyGlobals ||
            (cr.spec.repo.defaultBranch ===
              strategyGlobals.values.defaultBranch &&
              cr.spec.branchProtections ===
                strategyGlobals.values.branchProtections)
          );
        },

        apply(cr: any) {
          if (strategyGlobals) {
            cr.spec.repo.defaultBranch = strategyGlobals.values.defaultBranch;

            cr.spec.branchProtections =
              strategyGlobals.values.branchProtections;
          } else if (claim.providers.github.branchStrategy.name === 'none') {
            cr.spec.repo.defaultBranch =
              claim.providers.github.branchStrategy.defaultBranch;

            cr.spec.branchProtections = [];
          } else if (
            claim.providers.github.branchStrategy.name === 'custom' &&
            previousCR
          ) {
            cr.spec.repo.defaultBranch =
              claim.providers.github.branchStrategy.defaultBranch;

            cr.spec.branchProtections = previousCR.spec.branchProtections;
          }

          // fallback to empty array
          cr.spec.branchProtections = cr.spec?.branchProtections ?? [];

          delete cr.metadata.annotations[
            common.generic.getFirestartrAnnotation('branchStrategy')
          ];

          return cr;
        },

        identify() {
          return 'expander/BranchStrategies';
        },
      },
    ];
  }
}
