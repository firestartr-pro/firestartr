import { getComponentVarsAndSecretsRefs } from "../src/refsSorter/refsExtractor";
import * as fs from "fs";
import * as path from "path";
import { Testing, YamlOutputType } from 'cdk8s';
import { render } from '../src/renderer/renderer';
import { AllowedProviders, configureProvider, setExcludedPaths, setPath } from '../src/config';
import { emptyRenderedClaims } from '../src/refresolver';
import { resetLazyLoader } from "../src/loader/lazy_loader";

import {
  claimsRefListAsGenerator,
  resolveClaimEntries,
} from '../src/utils/claimUtils';

import fjp from 'fast-json-patch'

import { createTestContext } from "./auxiliar";

describe("A component", () => {

    jest.setTimeout(30000);
    configureProvider(AllowedProviders.all)
    const outDirPath: string = path.join("/", "tmp", ".resourcesCDK8s");

    process.env['ORG'] = 'firestartr-test'

    let context = null

    beforeAll(async () => {
        context = await createTestContext({})
    })

    beforeEach(async () => {
    
        emptyRenderedClaims()
        fs.rmSync(outDirPath, { recursive: true, force: true });

    });

    beforeEach(async () => {
        resetLazyLoader()
        context = await context.restart()
    })

    it("can define vars", async () => {

        setPath("initializers", path.join(__dirname, "fixtures/initializers"))
        setPath("crs", path.join(__dirname, "fixtures/base_crs"))
        setPath("globals", path.join(__dirname, "fixtures/globals"))
        setPath("claims", context.getClaimsDir())
        setPath("claimsDefaults", path.join(__dirname, "fixtures/initializers"))
        setExcludedPaths([path.join(__dirname, "fixtures/crs/.github")])

        await context.applyPatches(
        
            "component_a",

            [
                {
                    op: "add", path: "/providers/github/vars", value: {
                    
                        actions: [
                
                            {
                                name: "FOO",

                                value: "ref:secretsclaim:secret_a:rds_conn"
                            },

                            {
                                name: "FOO2",

                                value: "FOO2-VALUE"
                            }
                
                        ]

                    }
                }
            ]
        
        )

        const catalogApp = Testing.app({
          outdir: "/tmp/.catalog",
          outputFileExtension: ".yaml",
          yamlOutputType: YamlOutputType.FILE_PER_RESOURCE,
        });

        const app = Testing.app({
          outdir: outDirPath,
          outputFileExtension: ".yaml",
          yamlOutputType: YamlOutputType.FILE_PER_RESOURCE,
        });

        await render(catalogApp, app, resolveClaimEntries([context.getClaimsDir()]))

        app.synth()
        catalogApp.synth()

        expect(
            
            await context.testRenderedCR(

                'FirestartrGithubRepository', 

                'component-a', 

                {
                    op: "test", 

                    path: '/spec/vars/actions', 

                    value: [

                        {name: "FOO", ref: {kind: "Secret", name: "secret_a", key: "rds_conn"}},

                        {name: "FOO2", value: "FOO2-VALUE"}
                    ]

                },

                outDirPath


            )

        ).toEqual(true)
                                 
    })

    it("vars definition is one-way", async () => {

        setPath("initializers", path.join(__dirname, "fixtures/initializers"))
        setPath("crs", context.getPreviousCRsDir())
        setPath("globals", path.join(__dirname, "fixtures/globals"))
        setPath("claims", context.getClaimsDir())
        setPath("claimsDefaults", path.join(__dirname, "fixtures/initializers"))
        setExcludedPaths([path.join(__dirname, "fixtures/crs/.github")])

        await context.applyPatchToPreviousCR(
        
                'FirestartrGithubRepository', 

                'component-a', 

                {
                    op: "add",

                    path: "/spec/vars",

                    value: {
                    
                        actions: [

                            {name: "FOO", ref: {kind: "Secret", name: "secret_a", key: "rds_conn"}},

                            {name: "FOO2", value: "FOO2-VALUE"}
                        
                        ]
                    
                    }
                }
        )

        const catalogApp = Testing.app({
          outdir: "/tmp/.catalog",
          outputFileExtension: ".yaml",
          yamlOutputType: YamlOutputType.FILE_PER_RESOURCE,
        });

        const app = Testing.app({
          outdir: outDirPath,
          outputFileExtension: ".yaml",
          yamlOutputType: YamlOutputType.FILE_PER_RESOURCE,
        });

        await render(catalogApp, app, resolveClaimEntries([context.getClaimsDir()]))

        app.synth()
        catalogApp.synth()

        expect(
            
            await context.testRenderedCR(

                'FirestartrGithubRepository', 

                'component-a', 

                {
                    op: "test", 

                    path: '/spec/vars',

                    value: {}


                },

                outDirPath


            )

        ).toEqual(true)
                                 
    })

})
