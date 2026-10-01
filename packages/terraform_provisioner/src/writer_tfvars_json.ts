import { resolveValues, resolveClaimSecrets } from './resolutor';
import Writer from './writer';

export class WriterTfVarsJson extends Writer {
  values: string;
  references: any;

  constructor(values: any, references: any) {
    super();

    this.values = values;
    this.references = references;
  }

  __replaceReferences(values: any, references: any) {
    values = resolveValues(values, references);

    values = resolveClaimSecrets(values, references);

    return values;
  }

  __resolveDeps(): any {
    const replaced = this.__replaceReferences(this.values, this.references);

    return replaced;
  }

  async _render(): Promise<string> {
    this.output = JSON.stringify(this.__resolveDeps(), null, 2);

    return this.output;
  }
}

function fCheckString(keys: string[], refs: any) {
  for (const keyfiltered of keys) {
    const keySplitted = keyfiltered.split('.')[1];
    const keyReplaced = keySplitted.replace('}}', '');
    const keyTrimmed = keyReplaced.trim();

    if (typeof refs[keyTrimmed] !== 'string') {
      return false;
    }
  }

  return true;
}
