import * as fs from 'fs';

export default abstract class {
  output = '';

  constructor() {}

  async render(): Promise<string> {
    await this._render();

    return (this.output ?? '').trim();
  }

  abstract _render(): Promise<any>;

  writeToTerraformProject(mainTfPath: string) {
    const dir = mainTfPath.split('/').slice(0, -1).join('/');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (typeof this.output !== 'string') {
      throw new Error(
        'Writer output is not set. Did you forget to call render()?',
      );
    }
    fs.writeFileSync(mainTfPath, this.output, { encoding: 'utf8' });
  }
}
