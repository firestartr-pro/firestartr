import Doppleman from "./fixtures/k8s_doppleman";
import { ICustomResourcePatch } from "../src/patches";
import { NameNormalizer } from "../src/normalizers/name";
//import common from "catalog_common";


describe("Naming system", () => {

  it("Is able to validate a name", async () => {

      const claimValidName = {

        name: "valid-name",

        providers: {
        
          doppleman: {
          
            name: "valid-name"

          }
        
        }

      };

      const cr = {

        metadata: {},

      };

      let patches:ICustomResourcePatch[] = await new NameNormalizer().patches(

        claimValidName, {}

      );

      expect((await (new Doppleman(cr, patches)).render()))

        .toEqual({

          metadata: {

            name: claimValidName.name,

            annotations: {
            
              "firestartr.dev/external-name": "valid-name"
           
            }

          }

        })

      expect((await (new Doppleman({
      
        metadata: {
        
          name: "valid-name"
        
        }
      
      }, patches)).render()))

        .toEqual({

          metadata: {

            name: claimValidName.name,

            annotations: {
            
              "firestartr.dev/external-name": "valid-name"
           
            }

          }

        })


  })

  it("Is able to validate a name", async () => {

      const claimValidName = {

        name: "invalid_name",

        providers: {
        
          doppleman: {
          
            name: "invalid_name"

          }
        
        }

      };

      const cr = {

        metadata: {},

      };

      let patches:ICustomResourcePatch[] = await new NameNormalizer().patches(

        claimValidName, {}

      );

      expect((await (new Doppleman(cr, patches)).render()))

        .toEqual({

          metadata: {

            name: "invalid-name",

            annotations: {
            
              "firestartr.dev/external-name": "invalid_name"
           
            }

          }

        })


  })

  it.skip("Is able to control an irredimable name", async () => {

      const claim = {

        name: "__a b c__",

        providers: {
        
          doppleman: {
          
            name: "__a b c__"

          }
        
        }

      };

      const cr = {

        metadata: {},

      };

      let patches:ICustomResourcePatch[] = await new NameNormalizer().patches(

        claim, {}

      );

      expect((new Doppleman(cr, patches)).render())

        .rejects.toThrow(

          `INVALID_NAME: '${claim.name}'`
  
        )



  })

  it("Is able to control an very long nam", async () => {

    const long_name = Array.from(Array(3000).keys()).join("")

    const claim = {

      name: long_name,

      providers: {

        doppleman: {

          name: long_name,

        }

      }

    };

    const cr = {

      metadata: {},

    };

    let patches:ICustomResourcePatch[] = await new NameNormalizer().patches(

      claim, {}

    );

      expect(await (new Doppleman(cr, patches)).render())

        .toEqual({

          metadata: {

            name: long_name.substr(0, 200),

            annotations: {
            
              "firestartr.dev/external-name": long_name
           
            }

          }

        })

  })

  it("Is able to use a specific key for the catalog provider name", async () => {

    const claimValidName = {

      name: "invalid_name",

      providers: {

        catalog: {

          name: "invalid_name"

        }

      }

    };

    const cr = {

      metadata: {},

    };

    let patches: ICustomResourcePatch[] = await new NameNormalizer().patches(

      claimValidName, {}

    );

    const doppleman = new Doppleman(cr, patches);

    doppleman.set("provider", "catalog");

    expect((await doppleman.render()))

      .toEqual({

        metadata: {

          name: "invalid-name",

          annotations: {

            "title": "invalid_name"

          }

        }

      })


  });

})
