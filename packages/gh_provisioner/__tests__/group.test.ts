import {initSystemFS} from "../src"

import path from "path"

import {EntityGroup} from "../src/entities/group"

describe("Group entity", () => {

    let entity: EntityGroup;

    beforeEach(async () => {
    
        entity = await initSystemFS(

            path.join(__dirname, "fixtures/group/cr.yaml"),
        
            path.join(__dirname, "fixtures/group/deps.yaml"),
        
        ) as EntityGroup
    })

    it("is able to render its values", async () => {
    
        expect(entity instanceof EntityGroup).toBe(true)

        await entity.loadResources()

        expect(entity.document).toStrictEqual({
            config:{
                group: {
                    name: '私のチーム',
                    description: 'Prefapp all description',
                    privacy: 'closed',
                },
                group_members: [ { username: 'user-b', teamId: '16210767' } ]
            }
        })

    })

    it("is able to get its context", async () => {
    
        await entity.loadResources()

        const backend = entity.backend

        expect(backend.cr.kind).toBe("FirestartrProviderConfig")

        const provider = entity.provider

    })

    it("is able to produce a valid context", async () => {
    
    
    
    
    })

})
