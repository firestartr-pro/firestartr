import { InitializerPatches } from './base';
export class ComponentLabelsInitializer extends InitializerPatches {
  applicableProviders = ['github'];

  static applicableKinds = ['ComponentClaim'];

  async __validate() {
    return true;
  }

  async __patches(_claim: any, _previousCR: any) {
    return [
      {
        validate(cr: any) {
          if (cr.spec.repo.labels) {
            const visited = new Set<string>();

            for (const label of cr.spec.repo.labels) {
              if (visited.has(label.name)) {
                throw `There is already a label called ${label.name} in the ComponentClaim ${cr.metadata.name}. Labels must be unique`;
              }

              visited.add(label.name);
            }
          }

          return true;
        },

        apply(cr: any) {
          return cr;
        },

        identify() {
          return 'initializers/ComponentLabels';
        },
      },
    ];
  }
}
