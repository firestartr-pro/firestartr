import { GlobalSection } from './base';

export class TechnologyGlobal extends GlobalSection {
  protected static fileName?: string = 'globals_technology';

  protected static applicableKinds: string[] = ['ComponentClaim'];

  applicableProviders = ['github'];

  async __validate() {
    return true;
  }

  async __patches(_claim: any, __previousCR: any) {
    const data = this.data.values;

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
          return 'globals/Technology';
        },
      },
    ];
  }
}
