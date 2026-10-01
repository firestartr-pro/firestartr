import { Testing, YamlOutputType } from 'cdk8s';
import { render } from '../src/renderer/renderer';
import { AllowedProviders, configureProvider, setExcludedPaths, setPath } from '../src/config';
import * as fs from "fs";
import * as path from "path";
import { emptyRenderedClaims } from '../src/refresolver';
import { resetLazyLoader } from "../src/loader/lazy_loader";

import {
  claimsRefListAsGenerator,
  resolveClaimEntries,
} from '../src/utils/claimUtils';

import { createTestContext } from "./auxiliar";

describe("Cross references", () => {

  let context = null

  configureProvider(AllowedProviders.all)

  process.env['ORG'] = 'firestartr-test'

  const outDirPath: string = path.join("/", "tmp", ".resourcesCDK8s");

  beforeAll(async () => {
  
      context = await createTestContext({})
  
  })

  beforeEach(async () => {
    emptyRenderedClaims()
    fs.rmSync(outDirPath, { recursive: true, force: true });
  });

  beforeEach(async () => {

    resetLazyLoader()

	await context.restart()

  })

  async function testRender(context: any, ref: string){

    resetLazyLoader()

    emptyRenderedClaims()

    setPath("initializers", path.join(__dirname, "fixtures/initializers"))
    setPath("crs", path.join(__dirname, "fixtures/crs"))
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

    await render(catalogApp, app, await claimsRefListAsGenerator(['ComponentClaim-component_a']))
  }

  it('can be checked at the SecretClaim key-level', async () => {

    await context.applyPatches(
    
        "component_a",

        [

            {
                op: "add", path: "/providers/github/secrets", 

                value: {

                    actions: [

                        {
                            name: "SECRET_1",
                            value: 'ref:secretsclaim:secret_a:rds_conn'
                        }

                    ]

                }
            }
        ]
    
    )

    await testRender(context, 'ComponentClaim-component_a')

    await context.restart()

    await context.applyPatches(
    
        "component_a",

        [

            {
                op: "add", path: "/providers/github/secrets", 

                value: {

                    actions: [

                        {
                            name: "SECRET_1",
                            value: 'ref:secretsclaim:secret_a:not-existent-key'
                        }

                    ]

                }
            }
        ]
    
    )

    let errMsg = null

    try{
        await testRender(context, 'ComponentClaim-component_a')
    }
    catch(err){
    
        errMsg = err.message
    }

    expect(errMsg).toEqual(
        "CrossReference error: ComponentClaim/component_a references a secret key inexistent: 'secret_a/not-existent-key'"
    )
  
  })

})
