import { InitializerClaimRef } from "../src/initializers/claimRef";
import { ICustomResourcePatch } from "../src/patches";
import Doppleman from "./fixtures/k8s_doppleman";
import common from 'catalog_common';

describe('Claim_from annotation', () => {

    it('Is always present', async () => {

      const originalClaim = {
      
        kind: "testClaim",

        name: "name"
      
      }

      // first defintion (no claim no previousCR)
      let patches: ICustomResourcePatch[] = await new InitializerClaimRef({})
      
        .patches(originalClaim, {});

      const doppleman: Doppleman = new Doppleman(originalClaim, patches)

      doppleman.set("provider", "github")

      expect((await doppleman.render())).toEqual({
        ...originalClaim,
 
        "metadata": {
        
          "annotations": {
          
            [common.generic.getFirestartrAnnotation('claim-ref')]: "testClaim/name"
          
          },
          
          "labels": {
            "claim-ref": "name",
          },
        }       

      });
      

    });

});
