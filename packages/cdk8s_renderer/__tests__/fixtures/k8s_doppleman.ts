import { ICustomResourcePatch } from "../../src/patches"

import {helperIsPatchApplicable} from "../../src/charts/helpers"

export default class {

  claim:any = {}

  patches:ICustomResourcePatch[] = []

  data:any = {}

  get(k: string): any { return this.data[k]; }

  set(k: string, v: any) { this.data[k] = v; }

  constructor(claim:any, patches:ICustomResourcePatch[]){

    this.claim = claim
    this.patches = patches

  }

  get filteredPatches() {

    const patches = this.patches;

    return patches.filter((patch: any) => {

      return helperIsPatchApplicable(this, patch)

    })

  }

  async render(){

    const fClone = (obj:any) => JSON.parse(JSON.stringify(obj));

    let claim = fClone(this.claim)

    for (const patch of this.filteredPatches) {

      patch.ctx = () => this.ctx();

      claim = await patch.apply(fClone(claim))

      patch.validate(claim)
    }

    return claim

  }

  ctx(){

    const provider = this.get("provider") ?? "doppleman"

    return {

      get kind(){

        return 'k8s-doppleman'

      },

      get provider(){

        return provider

      }

    }
  }

}
