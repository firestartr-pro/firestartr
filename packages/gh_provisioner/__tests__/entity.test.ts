import {Entity, PatchOperations} from "../src/entities/base"

import { initSystem } from "../src"

describe("Entity", () => {

    it("is constructed with empty deps instead of failing on them", async () => {
        const entity = await initSystem({
            kind: "FirestartrGithubGroup",
            apiVersion: "firestartr.dev/v1",
            metadata: { name: "group-empty", annotations: {} },
            spec: { description: "d", privacy: "closed", members: [] },
        }, {})

        expect(entity).toBeTruthy()
    })

    it("can be derived and used", () => {
 
        class B extends Entity {
        
            constructor(){
            
                super({
                
                    kind: "test",

                    apiVersion: "v1",

                    metadata: {
                    
                        annotations: {}
                    },

                    spec: {
                    
                    }
                
                }, {
                
                    a: 1, 

                    b: 2

                })
            }

            async loadResources(): Promise<void> {
            
            }

            async postProvision(): Promise<void> {
            
            }

            async loadAddressesToImport(): Promise<void> {
            
            }
        }

        const b = new B()

        b.patchData({
        
            path: "/extra",

            op: PatchOperations.add,

            value: {
         
                c: 3,
                d: 4,
            }
        })   

        expect(b.document).toEqual({
        
            a: 1,
        
            b: 2,

            extra: {

                c: 3,
    
                d: 4   
            }
        })
    
    })

})
