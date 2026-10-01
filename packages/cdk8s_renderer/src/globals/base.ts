import { BasePatches } from '../patches/base';

export abstract class GlobalSection extends BasePatches {
  protected data: any = {};

  protected static fileName?: string;

  protected static applicableKinds: string[] = [];

  abstract __validate(): Promise<boolean>;

  constructor(data: any) {
    super();

    if (data?.globalValues) {
      this.data['values'] = data.globalValues;
    }
  }

  static FILE_NAME(): string {
    if (!this.fileName) {
      throw new GlobalSectionError('No file name especified');
    }

    return this.fileName;
  }

  async validate() {
    return await this.__validate();
  }

  async patches(claim: any, previousCR: any) {
    this.data['claim'] = claim;

    this.data['previousCR'] = previousCR;

    return await super.patches(claim, previousCR);
  }
}

export class GlobalSectionError extends Error {
  constructor(message: string) {
    super(message);

    Object.setPrototypeOf(this, GlobalSectionError.prototype);
  }
}
