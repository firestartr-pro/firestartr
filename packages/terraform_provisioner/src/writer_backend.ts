import Writer from './writer';

export class WriterBackend extends Writer {
  type: 'aws' | 'kubernetes' | 'azurerm' = 'kubernetes';
  config: any;
  tfStateKey: string;

  constructor(
    type: 'aws' | 'kubernetes' | 'azurerm' = 'kubernetes',
    config: any,
    tfStateKey: string,
  ) {
    super();

    this.type = type;
    this.config = config;
    this.tfStateKey = tfStateKey;
  }

  async _render() {
    switch (this.type) {
      case 'aws':
        await this.__renderAWSBackend();
        break;

      case 'kubernetes':
        await this.__renderKubernetesBackend();
        break;

      case 'azurerm':
        await this.__renderAzureBackend();
        break;

      default:
        throw new Error(`Backend type ${this.type} not supported`);
    }
  }

  async __renderAWSBackend() {
    this.output = '';

    for (const key of Object.keys(this.config)) {
      this.output += `${key} = "${this.config[key]}"\n`;
    }

    this.output = `
    backend "s3" {
          ${this.output}
    key = "${this.tfStateKey}"
  }
    `;
  }

  async __renderKubernetesBackend() {
    this.output = `
    backend "kubernetes" {
    secret_suffix = "${this.tfStateKey.split('/').join('-')}"
    in_cluster_config = true
    namespace = "${this.config.namespace}"
  }
`;
  }

  async __renderAzureBackend() {
    this.output = '';

    for (const key of Object.keys(this.config)) {
      this.output += `  ${key} = "${this.config[key]}"\n`;
    }

    this.output = `
    backend "azurerm" {

    ${this.output}
    key                  = "${this.tfStateKey}"
  }
    `;
  }
}
