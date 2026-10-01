import { SyncerInitializer } from "../src/initializers/syncer";

import Doppleman from "./fixtures/k8s_doppleman";

import { ICustomResourcePatch } from "../src/patches";

describe('Sync initializer', () => {

    it('can apply patch', async () => {

      const claim = {

        name: "sync-me",

        providers: {
        
          doppleman: {
          
            name: "sync-me",

            sync: {
            
              enabled: true,

              period: "3h",

              policy: "apply"
            
            }


          }
        
        }

      };

      const cr = {

        metadata: {
        
          annotations: {
          
          }
        
        },

      };

      let patches:ICustomResourcePatch[] = await new SyncerInitializer().patches(

        claim, {}

      );

      expect((await (new Doppleman(cr, patches)).render()))

        .toEqual({

          metadata: {

            annotations: {
            
              "firestartr.dev/sync-enabled": "true",

              "firestartr.dev/sync-period": "3h",

              "firestartr.dev/sync-policy": "apply"
           
            }

          }

        })

      

    });

    it('can validate the patch', async () => {

      const claim = {

        name: "sync-me-erroneus",

        providers: {
        
          doppleman: {
          
            name: "sync-me",

            sync: {
            
              enabled: true,

              period: "3k"
            
            }


          }
        
        }

      };

      const cr = {

        kind: "test",

        metadata: {

          name: "sync-me-erroneus",
        
          annotations: {
          
          }
        
        },

      };

      let patches:ICustomResourcePatch[] = await new SyncerInitializer().patches(

        claim, {}

      );

      async function render(){
      
        await (new Doppleman(cr, patches).render())

        throw "ERROR"

      }

      try{
      
        await render()
      
      }
      catch(err){
      
        expect(err).toMatch('initializers/SyncerInitializer: period incorrect \'3k\' for test/sync-me-erroneus')
      }


    });

    it('can validate the policy patch', async () => {

      const claim = {

        name: "sync-me-erroneus",

        providers: {
        
          doppleman: {
          
            name: "sync-me",

            sync: {
            
              enabled: true,

              period: "3m",

              policy: "apply"
            
            }


          }
        
        }

      };

      const cr = {

        kind: "test",

        metadata: {

          name: "sync-me-erroneus-policy",
        
          annotations: {

            "firestartr.dev/policy": "observe"
          
          }
        
        },

      };

      let patches:ICustomResourcePatch[] = await new SyncerInitializer().patches(

        claim, {}

      );

      async function render(){
      
        await (new Doppleman(cr, patches).render())

        throw "ERROR"

      }

      try{
      
        await render()
      
      }
      catch(err){
      
        expect(err).toMatch(
        
          'initializers/SyncerInitializer: incompatible policies \'observe\' and \'apply\' for k8s-doppleman/sync-me-erroneus-policy'
        
        )

      }


    });

});
