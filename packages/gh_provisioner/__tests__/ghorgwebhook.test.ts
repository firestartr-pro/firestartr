import {initSystemFS} from "../src"

import path from "path"

import {EntityGHOrgWebHook} from "../src/entities/ghorgwebhook"

import {Entity} from "../src/entities"

describe("EntityGHWebHook entity", () => {

    let entity: EntityGHOrgWebHook;

    beforeEach(async () => {
    
        entity = await initSystemFS(

            path.join(__dirname, "fixtures/ghorgwebhook/cr.yaml"),
        
            path.join(__dirname, "fixtures/ghorgwebhook/deps.yaml"),
        
        ) as EntityGHOrgWebHook
    })

    beforeEach(() => {
    
        // mock the resolver
        Entity.setRefResolver(({name, kind}: any = {}) => {
        
            if(kind === 'Secret'){
            
                if(name === 'my-webhook-secret'){
                
                    return {
                        
                        getOutput: (key: string) => 'secret-xxx'
                    
                    }
                
                }
            }
        
        })
    
    })

    it("is able to render its values", async () => {
    
        expect(entity instanceof EntityGHOrgWebHook).toBe(true)

        await entity.loadResources("apply")

		console.log(JSON.stringify(entity.document, null, 2))
    })


})
