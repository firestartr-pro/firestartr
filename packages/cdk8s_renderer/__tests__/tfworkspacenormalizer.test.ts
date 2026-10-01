import { TFWorkspaceNormalizer } from "../src/normalizers/tfworkspace";
import * as path from "path";
import * as fs from "fs";
import common from "catalog_common";

import {createTestContext} from "./auxiliar";

describe('TFWorkspace normalizer', () => {

    let context = null

    beforeEach(async () => {
    
        context = await createTestContext({})

    })

    afterEach(async () => {
    
        await context.destroy()
    
    })

    it('Normalize terraform files properly', async () => {

        // Load the claim
        const claim = common.io.fromYaml(await context.getFile("workspace_c"));

        // Prepare the dummy CR
        let dummyCr = {
            spec: {
                source: "Inline",
            }
        }

        // Instantiate the normalizer
        const normalizer = new TFWorkspaceNormalizer({path: await context.getFilePath("workspace_c") });

        // Get the patches
        const patches = await normalizer.patches(claim, null);

        
        // Apply the patches
        for(const patch of patches) {
            
            dummyCr = await patch.apply(dummyCr);
        
        }

        // Format the CR
        const yamlFormatted = common.io.toYaml(dummyCr);

        // Load the expected content
        const expectedContent = await context.getFile("workspace_c-results")
            

        // Compare the formatted CR with the expected content
        expect(yamlFormatted).toBe(expectedContent);

    });

    it('Loads additional files in the TFWorkspace correctly', async () => {

        await context.applyPatches(

            "workspace_c",

            [
                {
                    op: "add", path: "/providers/terraform/files", value: [
                
                        {
                            source: "./workspace_c-results.result",
                            destination: "./workspace_c-results"
                        }
                
                    ]
                }
            ]

        )

        const claim = common.io.fromYaml(await context.getFile("workspace_c"));

        let dummyCr:any = {
            spec: {
                source: "Inline",
            }
        }

        const normalizer = new TFWorkspaceNormalizer({path: await context.getFilePath("workspace_c") });

        const patches = await normalizer.patches(claim, null);

        for(const patch of patches) {
            
            dummyCr = await patch.apply(dummyCr);
        
        }

        const expectedContent = await context.getFile("workspace_c-results")

        expect(dummyCr.spec.files[0].content).toBe(Buffer.from(expectedContent).toString('base64'))
        expect(dummyCr.spec.files[0].path).toBe('./workspace_c-results')
    });

});
