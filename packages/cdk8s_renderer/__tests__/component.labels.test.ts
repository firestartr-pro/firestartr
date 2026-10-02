import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Testing, YamlOutputType } from 'cdk8s';
import { render } from '../src/renderer/renderer';
import { AllowedProviders, configureProvider, setExcludedPaths, setPath } from '../src/config';
import { emptyRenderedClaims } from '../src/refresolver';
import { resetLazyLoader } from "../src/loader/lazy_loader";

import {
  resolveClaimEntries,
} from '../src/utils/claimUtils';
import { createTestContext, rendererTestFixtures } from "./auxiliar";
import type { RendererTestContext } from './auxiliar';

describe("A component", () => {

    jest.setTimeout(30000);
    configureProvider(AllowedProviders.all)
    const outDirPath: string = fs.mkdtempSync(path.join(os.tmpdir(), ".resourcesCDK8s-"));

    afterAll(() => fs.rmSync(outDirPath, { recursive: true, force: true }));

    process.env['ORG'] = 'firestartr-test'

    let context: RendererTestContext;

    beforeAll(async () => {
        context = await createTestContext({})
    })

    beforeEach(async () => {

        emptyRenderedClaims()
        fs.rmSync(outDirPath, { recursive: true, force: true });

    });

    beforeEach(async () => {
       context = await context.resetRendererState();
    })

    it("can define labels", async () => {

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
                    op: "add", path: "/providers/github/labels", value: [

                        {
                            name: "label 1",

                            color: "ffffff"
                        },

                        {
                            name: "label 2",

                            color: "000000",

                            description: "My description"
                        }


                    ]
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

                    path: '/spec/repo/labels',

                    value: [

                        {name: "label 1", color: "ffffff"},

                        {name: "label 2", color: "000000", description: "My description"},
                    ]

                },

                outDirPath


            )

        ).toEqual(true)

    })

    it("validates its labels are unique", async () => {

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
                    op: "add", path: "/providers/github/labels", value: [

                        {
                            name: "label 1",

                            color: "ffffff"
                        },

                        {
                            name: "label 2",

                            color: "000000",

                            description: "My description"
                        },

                        {
                            name: "label 1",

                            color: "000001",

                            description: "My description"
                        }


                    ]
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

        let error

        try{
            await render(catalogApp, app, resolveClaimEntries([context.getClaimsDir()]))
        }
        catch(err){
            error = err
        }

        expect(error).toContain("Labels must be unique")

    })

    it("validates its labels using the JSON schema", async () => {
      setPath("initializers", path.join(__dirname, "fixtures/initializers"))
      setPath("crs", path.join(__dirname, "fixtures/base_crs"))
      setPath("globals", path.join(__dirname, "fixtures/globals"))
      setPath("claims", context.getClaimsDir())
      setPath("claimsDefaults", path.join(__dirname, "fixtures/initializers"))
      setExcludedPaths([path.join(__dirname, "fixtures/crs/.github")])

      const errorLabels = [{
        value: [{ name: "", color: "ffffff" }],
        errorMsg: "name: must NOT have fewer than 1 characters",
      }, {
        value: [{ name: " ", color: "ffffff" }],
        errorMsg: `name: must match pattern \"^[^\"\\\\\\s]+(?: +[^\"\\\\\\s]+)*$\"`,
      }, {
        value: [{ name: '""""""""""""""""""', color: "ffffff" }],
        errorMsg: `name: must match pattern \"^[^\"\\\\\\s]+(?: +[^\"\\\\\\s]+)*$\"`,
      }, {
        value: [{ name: `\\\\\\\\\\\\`, color: "ffffff" }],
        errorMsg: `name: must match pattern \"^[^\"\\\\\\s]+(?: +[^\"\\\\\\s]+)*$\"`,
      }, {
        value: [{ name: "test", color: "" }],
        errorMsg: `color: must match pattern \"^[0-9a-fA-F]{6}$\"`,
      }, {
        value: [{ name: "test", color: " " }],
        errorMsg: `color: must match pattern \"^[0-9a-fA-F]{6}$\"`,
      }, {
        value: [{ name: "test", color: "xxxxx" }],
        errorMsg: `color: must match pattern \"^[0-9a-fA-F]{6}$\"`,
      }]

      for (const labelData of errorLabels) {
        let error;

        await context.applyPatches("component_a", [{
          op: "add",
          path: "/providers/github/labels",
          value: labelData.value,
        }])

        try {
          await context.renderClaims(undefined, { crsPath: rendererTestFixtures.noCrs })
        } catch(err) {
          error = err
        }

        expect(error).toContain(labelData.errorMsg)

        fs.rmSync(outDirPath, { recursive: true, force: true });
      }
    })
})
