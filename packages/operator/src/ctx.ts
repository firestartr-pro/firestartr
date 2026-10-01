export class Ctx {
  data: any = {};

  compute: { [key: string]: Function };

  constructor(
    data: { [key: string]: any },

    compute: { [key: string]: Function },
  ) {
    this.data = data;

    this.compute = compute;
  }

  async exec(k: string) {
    return this.compute[k]();
  }

  setCompute(k: string, v: Function) {
    this.compute[k] = v;
  }

  set(k: string, v: any) {
    this.data[k] = v;
  }

  get(k: string) {
    return this.data[k];
  }
}
