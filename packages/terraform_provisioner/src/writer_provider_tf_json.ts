import Writer from './writer';
import log from './logger';
import { WriterTerraform } from './writer_terraform';

export class WriterProviderJson extends Writer {
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
    this.output = await new WriterTerraform(
      this.providers,
      this.backend,
      this.tfStateKey,
      false,
    ).render('json');
  }

  writeToTerraformProject(mainTfPath: string) {
    if (this.output.trim() === '') {
      log.info(
        `Skipping writing ${mainTfPath} as there is no provider to write.`,
      );
    } else {
      super.writeToTerraformProject(mainTfPath);
    }
  }
}
