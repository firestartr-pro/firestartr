import {Entity, PatchOperations} from "../src/entities/base"

describe("Entity", () => {

    beforeEach(() => {
    
        // let's mock the ref refsolver
        Entity.setRefResolver(() => {
        
        })
    
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
