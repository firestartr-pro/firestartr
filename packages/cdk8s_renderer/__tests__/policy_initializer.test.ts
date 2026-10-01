import { PolicyInitializer } from "../src/initializers/policy";
import { ICustomResourcePatch } from "../src/patches";
import Doppleman from "./fixtures/k8s_doppleman";

describe('Policy initializer', () => {

    it('Retrieves the previous cr policy', async () => {

      const originalClaim = {
      
        kind: "testClaim",

        name: "name",

        metadata: {

        },

        providers: {

            terraform: {

            }
        }
      
      }

      let patches: ICustomResourcePatch[] = await new PolicyInitializer({})

      .patches(
          
          originalClaim, 
          
          {
          
              metadata: {
                  
                  annotations: {
  
                      "firestartr.dev/policy": "apply"
                  
                  }
              }
      
          }
      
      );

      const doppleman: Doppleman = new Doppleman(originalClaim, patches)

      doppleman.set("provider", "terraform")

      expect((await doppleman.render())).toEqual({

            ...originalClaim,

            metadata: {
                
                annotations: {

                    "firestartr.dev/policy": "apply"
                }
            }
        
        });
      

    });


    it('Sets the claim policy, with priority against previous cr', async () => {

        const originalClaim = {
      
            kind: "testClaim",
    
            name: "name",
    
            metadata: {
    
            },
    
            providers: {
    
                terraform: {

                    policy: "apply"
    
                }
            }
          
          }
    
          let patches: ICustomResourcePatch[] = await new PolicyInitializer({})
    
            .patches(
                
                originalClaim, 
                
                {
                    // previous cr
                    metadata: {
                        
                        annotations: {
    
                            "firestartr.dev/policy": "observe"
                        
                        }
                    }
            
                }
            
            );
    
          const doppleman: Doppleman = new Doppleman(originalClaim, patches)
    
          doppleman.set("provider", "terraform")
    
          expect((await doppleman.render())).toEqual({
    
                ...originalClaim,
    
                metadata: {
                    
                    annotations: {
    
                        "firestartr.dev/policy": "apply"
                    }
                }
            
            });        
    });


    it('Sets the claim policy, with priority against previous cr', async () => {

        const originalClaim = {
      
            kind: "testClaim",
    
            name: "name",
    
            metadata: {
    
            },
    
            providers: {
    
                terraform: {

                    policy: "apply"
    
                }
            }
          
          }
    
          let patches: ICustomResourcePatch[] = await new PolicyInitializer({})
    
            .patches(
                
                originalClaim, 
                
                {
                    // previous cr
                    metadata: {
                        
                        annotations: {
    
                            "firestartr.dev/policy": "observe"
                        
                        }
                    }
            
                }
            
            );
    
          const doppleman: Doppleman = new Doppleman(originalClaim, patches)
    
          doppleman.set("provider", "terraform")
    
          expect((await doppleman.render())).toEqual({
    
                ...originalClaim,
    
                metadata: {
                    
                    annotations: {
    
                        "firestartr.dev/policy": "apply"
                    }
                }
            
            });        
    });

});

