import { ICustomResourcePatch } from '../patches';
import { BasePatches } from '../patches/base';

export abstract class InitializerPatches extends BasePatches {
  protected data: any = {};

  protected static fileName?: string;

  protected static applicableKinds: string[] = [];

  constructor(data?: any) {
    super();

    if (data?.defaultValues) {
      this.data['values'] = data.defaultValues;
    }
    if (data?.path) {
      this.data['path'] = data.path;
    }
  }

  abstract __patches(
    claim: any,
    previousCR: any,
  ): Promise<ICustomResourcePatch[]>;

  static FILE_NAME(): string {
    if (!this.fileName) {
      throw new InitializerError('No file name especified');
    }
    return this.fileName;
  }

  async validate(schema: any) {
    return await this.__validate(schema);
  }
}

export class InitializerError extends Error {
  constructor(message: string) {
    super(message);

    Object.setPrototypeOf(this, InitializerError.prototype);
  }
}
