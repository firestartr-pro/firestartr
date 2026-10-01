import Writer from './writer';
import { WriterBackend } from './writer_backend';
import { WriterProvider } from './writer_provider';
import { WriterRequiredProvider } from './writer_required_provider';

export class WriterTerraform extends Writer {
  requiredProviders: Array<any>;
  writeRequiredProvidersBlock: boolean;
  backend: any;
  tfStateKey: string;
  _tfStatePath: string;

  constructor(
    requiredProviders: Array<any>,
    backend: any,
    tfStateKey: string,
    writeRequiredProvidersBlock = true,
  ) {
    super();

    this.requiredProviders = requiredProviders;
    this.backend = backend;
    this.tfStateKey = tfStateKey;
    this.writeRequiredProvidersBlock = writeRequiredProvidersBlock;
  }

  set tfStatePath(tfStatePath: string) {
    this._tfStatePath = tfStatePath;
  }

  get tfStatePath() {
    return this._tfStatePath;
  }

  async render(renderType = 'tf'): Promise<string> {
    if (renderType === 'tf') {
      return super.render();
    } else {
      await this._renderJson();

      return this.output.trim();
    }
  }

  async _renderJson() {
    const providersString = await new WriterProvider(
      this.requiredProviders,
    ).render('json');

    if (providersString.trim() !== '{}') {
      this.output = `{
  "provider": ${providersString}
}`; // providersString is already a JSON object string
    } else {
      this.output = ''; // No providers to include
    }
  }

  async _render() {
    const providersString = await new WriterProvider(
      this.requiredProviders,
    ).render();

    let backend = '';

    if (this.backend) {
      const type: any = Object.keys(this.backend)[0];

      const tfBackendAddress = this.tfStatePath || this.tfStateKey;

      backend = await new WriterBackend(
        type,
        this.backend[type].config,
        tfBackendAddress,
      ).render();
    }

    let required_providers = '';

    if (this.writeRequiredProvidersBlock) {
      required_providers =
        this.requiredProviders.length > 0
          ? (
              await Promise.all(
                this.requiredProviders.map((provider: any) => {
                  return new WriterRequiredProvider(
                    provider.name,
                    provider.source,
                    provider.version,
                  ).render();
                }),
              )
            ).join('\n')
          : '';
    }

    this.output = `
terraform {

  ${backend}

  ${required_providers === '' ? required_providers : 'required_providers {\n' + required_providers + '\n}'}

}

${providersString}

    `;
  }
}
