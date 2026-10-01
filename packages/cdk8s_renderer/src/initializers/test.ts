import { InitializerPatches } from './base';
import Ajv from 'ajv/dist/2020';
import { helperCTX } from '../patches';

export class TestInitializer extends InitializerPatches {
  applicableProviders = ['github'];

  protected static fileName?: string = 'branch_strategies';

  async __validate(schema: any) {
    const ajv = new Ajv({
      allErrors: true,
    });

    const validate = ajv.compile(schema);

    return validate(this.data.values);
  }

  async __patches(claim: any, _previousCR: any) {
    console.log(claim);

    return [
      {
        validate(_cr: any) {
          return true;
        },

        apply(_cr: any) {
          console.log(helperCTX(this).kind);
          return _cr;
        },

        identify() {
          return 'initializers/Test';
        },
      },
    ];
  }
}
