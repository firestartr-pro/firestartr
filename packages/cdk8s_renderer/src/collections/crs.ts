import { BaseMap } from './map';

const CR_REF_REG = new RegExp(/^([a-zA-Z0-9-]+)\/([a-zA-Z0-9-]+)/);

export class MapCrs extends BaseMap {
  getClaimRef(crRef: string) {
    if (!CR_REF_REG.test(crRef)) throw `getClaimRef: invalid crRef ${crRef}`;

    if (this.hasElement(crRef)) {
      return this.getElement(crRef).metadata.annotations[
        'firestartr.dev/claim-ref'
      ];
    } else {
      throw `Ref not found: ${crRef}`;
    }
  }

  async __loadAll() {
    throw new Error('Method not implemented.');
  }

  async __loadElement(_index: string) {
    throw new Error('Method not implemented.');
  }

  __indexElement(cr: any): string {
    return `${cr.kind}/${cr.metadata.name}`;
  }

  __validateElement(cr: any) {
    if (!validateCR(cr)) {
      throw `__validateElement: CR not correct ${JSON.stringify(cr, null, 2)}`;
    }

    return true;
  }
}

function validateCR(cr: any) {
  return (
    'metadata' in cr &&
    'name' in cr.metadata &&
    'annotations' in cr.metadata &&
    'firestartr.dev/external-name' in cr.metadata.annotations &&
    'firestartr.dev/claim-ref' in cr.metadata.annotations
  );
}
