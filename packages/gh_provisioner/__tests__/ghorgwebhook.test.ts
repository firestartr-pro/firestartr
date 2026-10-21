import {initSystemFS} from "../src"

import path from "path"

import {EntityGHOrgWebHook} from "../src/entities/ghorgwebhook"

describe("EntityGHWebHook entity", () => {

    let entity: EntityGHOrgWebHook;

    beforeEach(async () => {

        entity = await initSystemFS(

            path.join(__dirname, "fixtures/ghorgwebhook/cr.yaml"),

            path.join(__dirname, "fixtures/ghorgwebhook/deps.yaml"),

        ) as EntityGHOrgWebHook
    })

    it("is able to render its values", async () => {

        expect(entity instanceof EntityGHOrgWebHook).toBe(true)

        await entity.loadResources("apply")

        const configuration = entity.document.config.webhook.configuration

        expect(configuration.secret).toBe("secret-xxx")
    })


})
