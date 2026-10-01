import { InitializerPatches } from './base';
export class TechnologyInitializer extends InitializerPatches {
  protected static fileName?: string = 'defaults_technology';

  protected static applicableKinds: string[] = ['ComponentClaim'];

  applicableProviders = ['github'];

  async __validate() {
    return true;
  }

  async __patches(_claim: any, _previousCR: any) {
    const data = this.data;

    return [
      {
        validate(cr: any) {
          return cr;
        },

        apply(cr: any) {
          cr.spec.firestartr.technology = data;

          return cr;
        },

        identify() {
          return 'initializers/TechnologyInitializer';
        },
      },
    ];
  }
}
