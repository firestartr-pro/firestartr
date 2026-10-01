import Writer from './writer';

export class WriterProvider extends Writer {
  providers: any[];
  jsonOutput = {};

  constructor(providers: any[]) {
    super();

    this.providers = providers;
  }

  async render(renderType = 'tf'): Promise<string> {
    await this._render();

    if (renderType === 'tf') {
      return this.output.trim();
    } else if (renderType === 'json') {
      return JSON.stringify(this.jsonOutput, null, 2);
    } else {
      throw new Error(`Unsupported render type: ${renderType}`);
    }
  }

  async _render() {
    for (const provider of this.providers) {
      if (provider.inline) {
        this.output += provider.inline + '\n';
      } else {
        this.__populateJsonOutput(provider);
      }
    }
  }

  __populateJsonOutput(provider: any) {
    if (this.jsonOutput[provider.name] === undefined) {
      this.jsonOutput[provider.name] = [];
    }

    this.jsonOutput[provider.name].push(provider.config);
  }
}
