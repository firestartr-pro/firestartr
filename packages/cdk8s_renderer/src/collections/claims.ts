import { ClaimValidation } from '../claims';
import { crawl } from '../crawler';
import { BaseMap } from './map';
import claims from '../claims/base';
import { InitializerPatches } from '../initializers/base';
import { GlobalSection } from '../globals/base';
import { Normalizer } from '../normalizers/base';
import { OverriderPatches } from '../overriders/base';

const CLAIM_REF_REG = new RegExp(/^([a-zA-Z0-9_\s]+)\/([a-zA-Z0-9_\s]+)/);

const isYamlFile = new RegExp(/\.(yaml|yml)$/);

export class MapClaims extends BaseMap {
  claimsDir: string;

  constructor(claimsDir: string) {
    super();

    this.claimsDir = claimsDir;
  }

  getRefForClaim(claim: any) {
    return this.__indexElement(claim);
  }

  getNameForProvider(claimRef: string, provider: string) {
    if (!CLAIM_REF_REG.test(claimRef)) {
      throw `getNameForProvider: invalid claimRef ${claimRef}`;
    }

    if (this.hasElement(claimRef)) {
      return this.getElement(claimRef).providers[provider].name;
    }
  }

  async __loadAll() {
    await crawl(
      this.claimsDir,

      (entry: string) => {
        return isYamlFile.test(entry);
      },

      async (entry: string, data: any) => {
        await this.addElement(new Claim(data, entry));
      },
    );
  }

  __validateElement(claim: any) {
    return ClaimValidation.validateClaim(
      claim,
      (claims as any)[`${claim.kind}Schema`],
    );
  }

  async __loadElement(_index: string) {
    throw new Error('Method not implemented.');
  }

  __indexElement(claim: any): string {
    return `${claim.kind}/${claim.name}`;
  }
}

export class Claim {
  /**
   * Claim instance
   */
  claim: any;

  /**
   * Modifier instances
   */
  initializers: InitializerPatches[] = [];

  globals: GlobalSection[] = [];

  normalizers: Normalizer[] = [];

  overrides: OverriderPatches[] = [];

  /**
   * Path to initializers
   */
  initializersPath: string;

  constructor(claim: any, initializersPath: string) {
    this.initializersPath = initializersPath;
    this.claim = claim;
  }

  addInitializers(initializer: InitializerPatches[]) {
    this.initializers = this.initializers.concat(initializer);
  }

  addGlobal(global: GlobalSection) {
    this.globals.push(global);
  }

  addNormalizer(normalizer: Normalizer) {
    this.normalizers.push(normalizer);
  }

  addOverrider(overrider: OverriderPatches) {
    this.overrides.push(overrider);
  }
}
