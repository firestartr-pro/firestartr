import { getComponentVarsAndSecretsRefs } from "../src/refsSorter/refsExtractor";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
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
    const outDirPath: string = fs.mkdtempSync(path.join(os.tmpdir(), ".resourcesCDK8s-"));

    afterAll(() => fs.rmSync(outDirPath, { recursive: true, force: true }));

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

    it("can make one-way oidc definitions", async () => {

        setPath("initializers", path.join(__dirname, "fixtures/initializers"))
        setPath("crs", context.getPreviousCRsDir())
        setPath("globals", path.join(__dirname, "fixtures/globals"))
        setPath("claims", context.getClaimsDir())
        setPath("claimsDefaults", path.join(__dirname, "fixtures/initializers"))
        setExcludedPaths([path.join(__dirname, "fixtures/crs/.github")])

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

        const catalogApp2 = Testing.app({
          outdir: "/tmp/.catalog",
          outputFileExtension: ".yaml",
          yamlOutputType: YamlOutputType.FILE_PER_RESOURCE,
        });

        const app2 = Testing.app({
          outdir: outDirPath,
          outputFileExtension: ".yaml",
          yamlOutputType: YamlOutputType.FILE_PER_RESOURCE,
        });

        emptyRenderedClaims()
        resetLazyLoader()

        setPath("crs", outDirPath)

        await context.applyPatches(

            "component_a",

            [
                {
                    op: "add", 
                    path: "/providers/github/actions",
                    value: {
                        oidc: {
                            includeClaimKeys: [
                                "a",
                                "b"
                            ]
                        }
                    }

                },

                {
                    op: "remove",
                    path: "/providers/github/overrides/spec/actions"
                }
            ]

        )

        await render(catalogApp2, app2, await resolveClaimEntries([context.getClaimsDir()]))

        app2.synth()
        catalogApp2.synth()

        expect(
            
            await context.testRenderedCR(

                'FirestartrGithubRepository', 

                'component-a', 

                {
                    op: "test", 

                    path: '/spec/actions/oidc',

                    value: {
                        useDefault: true,
                        includeClaimKeys: ['a', 'b']
                    }


                },

                outDirPath


            )

        ).toEqual(true)
                                 
    })

})
