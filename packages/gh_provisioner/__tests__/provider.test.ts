import {initSystemFS} from "../src"

import path from "path"

import {EntityGroup} from "../src/entities/group"

import {adaptProviders, adaptBackend} from "../src/providers"

describe("Providers adapter", () => {

    let entity: EntityGroup;

    beforeEach(async () => {
    
        entity = await initSystemFS(

            path.join(__dirname, "fixtures/group/cr.yaml"),
        
            path.join(__dirname, "fixtures/group/deps.yaml"),
        
        ) as EntityGroup
    })

    it("is able to adapt a provider", async () => {
    
        await entity.loadResources()

        adaptProviders(entity)

    })

    it("is able to adapt the backend", async () => {
    
        await entity.loadResources()

        adaptBackend(entity)

    })


})
