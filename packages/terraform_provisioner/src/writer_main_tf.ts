import Writer from './writer';

import { WriterTerraform } from './writer_terraform';

export class WriterMainTf extends Writer {
  providers: Array<any>;
  mainBlock: string;
  tfStateKey: string;
  backend: any;

  constructor(
    mainBlock: string,
    providers: Array<any>,
    backend: any,
    tfStateKey: string,
  ) {
    super();

    this.mainBlock = mainBlock;
    this.providers = providers;
    this.backend = backend;
    this.tfStateKey = tfStateKey;
  }

  async _render() {
    this.output = `

${await new WriterTerraform(
  this.providers,
  this.backend,
  this.tfStateKey,
  false,
).render()}

${this.mainBlock}

`;
  }
}
