import rss from "../src/charts/github/RepoSecretsSectionChart"
import {GithubRepositoryChart} from "../src/charts/github/repositoryChart"

import * as fs from "fs";
import * as path from "path";

import { render } from '../src/renderer/renderer';
import { AllowedProviders, configureProvider, setExcludedPaths, setPath } from '../src/config';

import { Testing, YamlOutputType } from 'cdk8s';

import { createTestContext } from "./auxiliar";

import { emptyRenderedClaims } from '../src/refresolver';
import { resetLazyLoader } from "../src/loader/lazy_loader";

import {
  claimsRefListAsGenerator,
  resolveClaimEntries,
} from '../src/utils/claimUtils';


let storedRSSection: string | undefined = undefined


describe("Repo's secrets section", () => {

    jest.setTimeout(30000);
    const outDirPath: string = path.join("/", "tmp", ".resourcesCDK8s");

    configureProvider(AllowedProviders.all)

    let context = null

    beforeAll(async () => {
        context = await createTestContext({})
    })

    beforeEach(async () => {
        fs.rmSync(outDirPath, { recursive: true, force: true });
        context = await context.restart()
    });

    beforeEach(async () => {
        emptyRenderedClaims()
        resetLazyLoader()
    })

    it('can be rendered', async () => {

        const app = Testing.app({
            outdir: outDirPath,
            outputFileExtension: ".yaml",
            yamlOutputType: YamlOutputType.FILE_PER_RESOURCE,
        })

        const chart = new rss(

            app,

            "foo",

            "aaa-aaa-aaa",

            {
                name: "test",

                providers: {

                    github: {

                        secrets: {
                        
                            actions: [
                            
                                {
                                    name: "FOO",

                                    value: "ref:secretsclaim:secret_a:rds_conn"
                                }
                            
                            ]
                        
                        }

                    }

                },

                org: "test",

                context: {

                },

            },

            [],

            {
                metadata: {
                
                    name: "test",

                    annotations: {
 
                        'firestartr.dev/claim-ref': 'ComponenClaim/test'                   

                    }
                },

                spec: {

                    firestartr: {

                        tfStateKey: "foo"
                    }
                
                }
            
            }

        )

        await chart.render()

        await chart.postRenderer([])

        app.synth();

    })

    it('can be rendered in a component\'s context', async () => {

        await context.applyPatches(
        
            "component_a",

            [
                {op: "remove", path: "/owner"},
                {op: "remove", path: "/platformOwner"},
                {op: "remove", path: "/maintainedBy"},
                {op: "remove", path: "/providers/github/codeowners"},
                {
                    op: "add",

                    path: '/providers/github/secrets',

                    value: {
                    
                        actions: [
                
                            {
                                name: "FOO",

                                value: "ref:secretsclaim:secret_a:rds_conn"
                            },

                            {
                                name: "FOO2",

                                value: "ref:secretsclaim:secret_a:rds_conn"
                            }
                
                        ]
                    }
                
                }
            ]

        )

        const componentClaim = context.fromYaml(await context.getFile('component_a'))

        const app = Testing.app({
            outdir: outDirPath,
            outputFileExtension: ".yaml",
            yamlOutputType: YamlOutputType.FILE_PER_RESOURCE,
        });

        const chart = new GithubRepositoryChart(

            app,

            "component_a",

            "aaa-aaa-aaa",

            componentClaim,

            [],

        )

        await chart.render()

        await chart.postRenderer([])

        app.synth();

        const rCr = await context.getRenderedCR('FirestartrGithubRepositorySecretsSection','component_a', outDirPath)

        storedRSSection = rCr 

    })

    it('can be rendered in a component\'s context in a one-way manner', async () => {

        // we fail if storedRSSection is not present
        if(!storedRSSection)
            throw `No storedRSSection stored: previous test failed or was ignored`

        let rCr = context.fromYaml(storedRSSection)

        fs.writeFileSync(
            path.join(await context.getPreviousCRsDir(), rCr.kind + '.' + rCr.metadata.name),
            storedRSSection
        )

        setPath("initializers", path.join(__dirname, "fixtures/initializers"))
       // setPath("crs", context.getPreviousCRsDir())
        setPath("crs", path.join(__dirname, 'fixtures/crs'))
        setPath("globals", path.join(__dirname, "fixtures/globals"))
        setPath("claims", context.getClaimsDir())
        setPath("claimsDefaults", path.join(__dirname, "fixtures/initializers"))
        setExcludedPaths([path.join(__dirname, "fixtures/crs/.github")])

        await context.applyPatches(
        
            "component_a",

            [
                {
                    op: "add",

                    path: '/providers/github/secrets',

                    value: {
                    
                        actions: [
                
                            {
                                name: "FOO34",

                                value: "ref:secretsclaim:secret_a:rds_conn"
                            },

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

        await render(catalogApp, app, await resolveClaimEntries([context.getClaimsDir()]))

        app.synth()
        catalogApp.synth()

        expect(await context.testRenderedCR(
        
          'FirestartrGithubRepositorySecretsSection',
          "component-a",
        
          {
              op: "test",

              path: "/spec/secrets/actions",

              value: [
                  {
                      name: "FOO34",
                      ref: {
                        kind: "Secret",
                        name: "secret_a",
                        key: "rds_conn"
                      }
                  }
              ]
          },
          outDirPath
        )).toBe(true)


    })

    it('can control an invalid key reference', async () => {

        await context.applyPatches(
        
            "component_a",

            [
                {
                    op: "add",

                    path: '/providers/github/secrets',

                    value: {
                    
                        actions: [
                
                            {
                                name: "FOO",

                                value: "ref:secretsclaim:secret_a:rds_conn"
                            },

                            {
                                name: "FOO2",

                                value: "ref:secretsclaim:secret_a:no_key"
                            }
                
                        ]
                    }
                
                }
            ]

        )

        setPath("initializers", path.join(__dirname, "fixtures/initializers"))
       // setPath("crs", context.getPreviousCRsDir())
        setPath("crs", path.join(__dirname, 'fixtures/crs'))
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

        let e = ''

        try{
        
            await render(catalogApp, app, await resolveClaimEntries([context.getClaimsDir()]))
        }
        catch(err){
        
            e = err.message
        }

        expect(e).toEqual(
        
            "CrossReference error: ComponentClaim/component_a references a secret key inexistent: 'secret_a/no_key'"
        )

        app.synth()
        catalogApp.synth()

    })

})
