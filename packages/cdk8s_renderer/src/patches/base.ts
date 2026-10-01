import { ICustomResourcePatch } from './index';

export abstract class BasePatches {
  constructor() {}

  abstract get applicableProviders(): string[];

  abstract __validate(data: any): Promise<boolean>;

  abstract __patches(
    claim: any,
    previousCR: any,
    crs?: any,
  ): Promise<ICustomResourcePatch[]>;

  async patches(claim: any, previousCR: any, crs?: any) {
    const applicableFn: Function = () => {
      return { applicableProviders: this.applicableProviders };
    };

    const patches = (await this.__patches(claim, previousCR, crs)).map(
      (patch: any) => {
        if (!patch.applicable) {
          patch.applicable = applicableFn;
        }

        return patch;
      },
    );

    return patches;
  }
}
