import {
  loadDependencies,
  initDepsSystem,
  initDepsSystemFromMemory,
  refResolver,
} from "../src/refs"

import {Entity} from "../src/entities"

import path from "path"


describe("Refs system", () => {

    it("is able to load a deps file", async () => {
    
        const deps = await loadDependencies(
        
            path.join(__dirname, "fixtures/group/deps.yaml")
        
        )

        expect(deps).toBeTruthy()
     
    })

    it("is able prepare a deps system", async () => {
    
        await initDepsSystem(
        
            path.join(__dirname, "fixtures/group/deps.yaml")
        
        )
    
    })

    it("is able to get a reference", async () => {
    
        await initDepsSystem(
        
            path.join(__dirname, "fixtures/group/deps.yaml")
        
        )
 
        Entity.setRefResolver(refResolver)

        const ref = refResolver({
        
            kind: "FirestartrGithubMembership", 
            
            name: "user-b-user",

            needsSecret: false
        
        })

        expect(ref).toBeTruthy()

    })

    it("is able to resolve group outputs from operator outputs blob", async () => {
        const tfOutputs = {
            team_id: { value: "16464102", type: "string", sensitive: false },
            team_slug: { value: "research-arc-dev", type: "string", sensitive: false },
            node_id: { value: "MDQ6VGVhbTE2NDY0MTAy", type: "string", sensitive: false },
        }

        await initDepsSystemFromMemory({
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

        Entity.setRefResolver(refResolver)

        const ref = refResolver({
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
