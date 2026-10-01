import Writer from './writer';

export class WriterImports extends Writer {
  config: any;

  constructor(config: any) {
    super();

    this.config = config;
  }

  async _render() {
    let importBlocks = '';

    for (const importBlock of this.config.imports) {
      importBlocks += `
        
   import {
       
       to = ${importBlock.to}

       id = "${importBlock.id}"
   }

        `;
    }

    this.output = importBlocks;
  }
}
