import jsonpointer from 'jsonpointer';

export default class FirestartrConfig {
  config: any = {};

  constructor(config: any) {
    this.config = config;
  }

  get raw() {
    return this.config;
  }

  get(pointer: string) {
    const r: any = jsonpointer.get(this.config, pointer);

    if (!r) {
      throw `Firestartr:config: unknown value ${pointer}`;
    }

    return r;
  }
}
