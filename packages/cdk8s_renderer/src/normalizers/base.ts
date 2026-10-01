import { ICustomResourcePatch } from '../patches';
import { BasePatches } from '../patches/base';

export abstract class Normalizer extends BasePatches {
  constructor(data?: any) {
    super();

    if (data) this.data = data;
  }

  protected data: any = {};

  protected static fileName?: string;

  protected static applicableKinds: string[] = [];

  abstract __patches(
    claim: any,
    previousCR: any,
  ): Promise<ICustomResourcePatch[]>;
}

export class NormalizerError extends Error {
  constructor(message: string) {
    super(message);

    Object.setPrototypeOf(this, NormalizerError.prototype);
  }
}
