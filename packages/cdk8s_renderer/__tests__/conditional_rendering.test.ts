import { AllowedProviders, configureProvider, reconfigureProvider, setExcludedPaths, setPath } from '../src/config';
import { resetLazyLoader } from '../src/loader/lazy_loader';
import * as path from "path";
import * as fs from "fs";
import common from "catalog_common";
import { render } from '../src/renderer/renderer';
import { Testing, YamlOutputType } from "cdk8s";
import { emptyRenderedClaims } from '../src/refresolver';

import {createTestContext} from "./auxiliar";

import {
  claimsRefListAsGenerator,
  resolveClaimEntries,
} from '../src/utils/claimUtils';

describe("The renderer conditionally", () => {

    jest.setTimeout(30000);

    let context = null

    beforeAll(async () => {
    
        context = await createTestContext({})
    
    })

    beforeEach(async () => {

        emptyRenderedClaims()

        resetLazyLoader()

        await context.restart()
    
    })

    async function prepareTest(context: any){
    
        setPath("crs", context.getBaseCrsDir());
        setPath("initializers", path.join(__dirname, "fixtures/initializers"));
        setPath("globals", path.join(__dirname, "fixtures/globals"));
        setPath("claims", await context.getClaimsDir());
        setPath("claimsDefaults", path.join(__dirname, "fixtures/initializers"));

        const catalogApp = Testing.app({

          outdir: context.getCatalogOutDir(),

          outputFileExtension: ".yaml",

          yamlOutputType: YamlOutputType.FILE_PER_RESOURCE,

        });

        const app = Testing.app({

          outdir: context.getResourcesOutDir(),

          outputFileExtension: ".yaml",

          yamlOutputType: YamlOutputType.FILE_PER_RESOURCE,

        });
    
        return {app, catalogApp}
    
    }

    it("render tfworkspaces", async () => {
 
        // here only tfworkspaces are rendered
        // no catalog   
        const {app, catalogApp} = await prepareTest(context)

        reconfigureProvider(AllowedProviders.terraform);

        await render(

            catalogApp, 

            app,

            resolveClaimEntries([
                await context.getClaimsDir()
            ])

        )

        app.synth();
        catalogApp.synth();

        const r = await context.getRenderedCR("FirestartrTerraformWorkspace", "test-a")
        const r2 = await context.getRenderedCR("FirestartrGithubGroup", "firestartr-test-all")
        const r3 = await context.getRenderedCR("FirestartrGithubGroup", "group-a")

        const c = await context.getRenderedCatalogCR("Resource", "workspace-a")
        const c2 = await context.getRenderedCatalogCR("Domain", "domain-a")

        expect(typeof r).toEqual("string")
        expect(r2).toEqual(undefined)
        expect(r3).toEqual(undefined)

        expect(c).toEqual(undefined)
        expect(c2).toEqual(undefined)
    })

    it("render github and tfworkspaces", async () => {
    
        const {app, catalogApp} = await prepareTest(context)

        // here tfworkspaces and github elements are rendered
        // catalog is also rendered
        reconfigureProvider(AllowedProviders.all);

        await render(
            catalogApp, 

            app,

            resolveClaimEntries([
                await context.getClaimsDir()
            ])
        )

        app.synth();
        catalogApp.synth();

        const r = await context.getRenderedCR("FirestartrTerraformWorkspace", "test-a")
        const r2 = await context.getRenderedCR("FirestartrGithubGroup", "firestartr-test-all")
        const r3 = await context.getRenderedCR("FirestartrGithubGroup", "group-a")

        const c = await context.getRenderedCatalogCR("Resource", "")
        const c2 = await context.getRenderedCatalogCR("Domain", "")

        expect(typeof r).toEqual("string")
        expect(typeof r2).toEqual("string")
        expect(typeof r3).toEqual("string")
    
        expect(typeof c).toEqual("string")
        expect(typeof c2).toEqual("string")
    })

})
