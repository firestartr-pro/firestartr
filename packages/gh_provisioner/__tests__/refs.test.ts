import { loadDependencies } from "../src/refs"

import { initSystem } from "../src"

import path from "path"

function groupCr(name: string) {
    return {
        kind: "FirestartrGithubGroup",
        apiVersion: "firestartr.dev/v1",
        metadata: { name, annotations: {} },
        spec: {
            description: "a group",
            privacy: "closed",
            members: [],
        },
    }
}

describe("Refs system", () => {

    it("is able to load a deps file", async () => {

        const deps = await loadDependencies(

            path.join(__dirname, "fixtures/group/deps.yaml")

        )

        expect(deps).toBeTruthy()

    })

    it("resolves a reference against the deps bound to its entity", async () => {

        const deps = await loadDependencies(

            path.join(__dirname, "fixtures/group/deps.yaml")
        )

        const entity = await initSystem(groupCr("group-jp-group"), deps)

        const ref = entity.resolveRef({

            kind: "FirestartrGithubMembership",

            name: "user-b-user",

            needsSecret: false

        })

        expect(ref).toBeTruthy()

    })

    it("does not resolve references missing from its own deps", async () => {

        const deps = await loadDependencies(

            path.join(__dirname, "fixtures/group/deps.yaml")
        )

        const entity = await initSystem(groupCr("group-jp-group"), deps)

        expect(entity.resolveRef({

            kind: "FirestartrGithubMembership",

            name: "user-that-does-not-exist",

        })).toBeNull()

    })

    it("is able to resolve group outputs from operator outputs blob", async () => {
        const tfOutputs = {
            team_id: { value: "16464102", type: "string", sensitive: false },
            team_slug: { value: "research-arc-dev", type: "string", sensitive: false },
            node_id: { value: "MDQ6VGVhbTE2NDY0MTAy", type: "string", sensitive: false },
        }

        const entity = await initSystem(groupCr("group-a"), {
            "FirestartrGithubGroup-group-a": {
                cr: {
                    apiVersion: "firestartr.dev/v1",
                    kind: "FirestartrGithubGroup",
                    metadata: {
                        name: "group-a",
                        annotations: {},
                    },
                    spec: {},
                },
                secret: {
                    apiVersion: "v1",
                    kind: "Secret",
                    data: {
                        outputs: Buffer.from(JSON.stringify(tfOutputs)).toString("base64"),
                    },
                },
            },
        } as any)

        const ref = entity.resolveRef({
            kind: "FirestartrGithubGroup",
            name: "group-a",
            needsSecret: true,
        })

        if (!ref) {
            throw new Error("Expected FirestartrGithubGroup reference to be resolved")
        }

        expect(ref.getOutput("team_id")).toBe("16464102")
        expect(ref.getOutput("id")).toBe("16464102")
        expect(ref.getOutput("team_slug")).toBe("research-arc-dev")
        expect(ref.getOutput("slug")).toBe("research-arc-dev")
        expect(ref.getOutput("node_id")).toBe("MDQ6VGVhbTE2NDY0MTAy")
        expect(ref.getOutput("nodeId")).toBe("MDQ6VGVhbTE2NDY0MTAy")

    })

})
