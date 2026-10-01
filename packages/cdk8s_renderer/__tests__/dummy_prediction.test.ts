import { Testing, YamlOutputType } from 'cdk8s';

import {
  FirestartrGithubRepositorySpecRepoVisibility
} from "../imports/firestartr.dev";
import { BranchStrategy } from "catalog_common";
import {

    DummyChart

} from "./fixtures/dummy/chart"

//import * as fs from "fs"

describe('dummy renderer', () => {

    jest.setTimeout(30000);

    //function slurp(path:string){
    //
    //        return fs.readFileSync(path, 'utf-8')

    //}


    it.skip('Is able to render a dummy chart', async () => {

    const app = Testing.app({

        outdir: "/tmp/.resources",

        outputFileExtension: ".yaml",

        yamlOutputType: YamlOutputType.FILE_PER_RESOURCE,

    });

    const app2 = Testing.app({

        outdir: "/tmp/.resources2",

        outputFileExtension: ".yaml",

        yamlOutputType: YamlOutputType.FILE_PER_RESOURCE,

    });

    console.log(app2)

    const claim = {

        kind: "Dummy",

        version: "1.0.0",

        name: "espinete",

        org: "test",

        branch: "master",

        lifecycle: "production",

        type: "service",

        system: "dummy-system",

        owner: "user:dummy-owner" as `user:${string}`,

        preferences: {

            strategy: "none",

            maxValue: 20

        },

        providers: {

          github: {

            description: "dummy",

            platformOwner: "user:dummy-powner" as `user:${string}`,

            org: "dummy-org",

            orgPermissions: 'none',

            technology: {

              stack: "python",

              version: "3.11",

            },

            actions: {

              oidc: { useDefault: false, includeClaimKeys: [] }

            },

            visibility: "private" as FirestartrGithubRepositorySpecRepoVisibility,

            branchStrategy: {
              name: "trunkBasedDevelopment" as BranchStrategy,
            },

            allowSquashMerge: false,

            allowMergeCommit: false,

            allowRebaseMerge: false,

            allowAutoMerge: false,

            deleteBranchOnMerge: false,

            autoInit: false,

            archiveOnDestroy: false,

            allowUpdateBranch: false,

            hasIssues: false,

            features: [

                {
                    name: "tech_docs",

                    version: "0.7.0"
                }

            ]

          }

        }


    }

    const claim2 = JSON.parse(JSON.stringify(claim))

    claim2.preferences.maxValue = 30

    const dummyChart = new DummyChart(app, "dummy", "dummy", claim, []) //).render()

    console.log(dummyChart)
    // expect(await dummyChart.changed(

    //   new DummyChart(app2, "dummy", "dummy", claim2, [])

    // )).toEqual(true)

  });

});
