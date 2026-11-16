import Writer from './writer';

export class WriterRequiredProvider extends Writer {
  name: string;
  source?: string;
  version?: string;

  constructor(name: string, source?: string, version?: string) {
    super();

    this.name = name;
    this.source = source;
    this.version = version;
  }

  async _render() {
    const lines: string[] = [];

    if (this.source !== undefined) {
      lines.push(`      source = "${this.source}"`);
    }

    if (this.version !== undefined) {
      lines.push(`      version = "${this.version}"`);
    }

    this.output = `
    ${this.name} = {
${lines.join('\n')}
    }
`;
  }
}
