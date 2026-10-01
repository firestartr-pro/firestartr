import Writer from './writer';

export class WriterRequiredProvider extends Writer {
  name: string;
  source: string;
  version: string;

  constructor(name: string, source: string, version: string) {
    super();

    this.name = name;
    this.source = source;
    this.version = version;
  }

  async _render() {
    this.output = `
    ${this.name} = {
      source = "${this.source}"
      version = "${this.version}"
    }
`;
  }
}
