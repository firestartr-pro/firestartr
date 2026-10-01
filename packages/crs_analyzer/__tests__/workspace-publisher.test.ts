import { CrsAnalyzer } from "../src/analyzers/crs-analyzer";
import { Context } from "../src/context";
import { KubernetesClient } from "../src/kubernetes-client";
import { CrsPublisher } from "../src/publishers/crs";
import { GithubClient } from "../src/github-client";
import { Cr } from "../src/models/cr";

let resolvedValue = null

jest.mock("../src/kubernetes-client", () => ({
    KubernetesClient: jest.fn().mockImplementation(() => ({

        constructor(){

        },

        listKind(){

            return resolvedValue
        }
    }))
}));


describe("Workspace publisher", () => {

   let MockKubernetesClient = null

    beforeEach(() => {
    
       MockKubernetesClient = KubernetesClient as jest.MockedClass<typeof KubernetesClient>;
    
    })

    it("Is able to build the drift pr body correctly", async () => {
  
          const context = new Context(
              "firestartr.dev",
              "v1",
              "terraformworkspaces", 
              "default",
              "org",
              "repo"
          );
  
          const cli = new MockKubernetesClient()
  
          resolvedValue = [
  			{
                  metadata: {
                      name: "test",
                      annotations: {
                        "firestartr.dev/claim-ref": "TFWorkspace/test"
                      }
                  },
                  status: {
                      conditions: [
                          {
                              type: "OUT_OF_SYNC",
                              status: "True",
                          },
                          {
                              type: "LAST_PLAN_DETAILS",
                              message: '{"create":["azurerm_management_lock.subscription_level"]}'
                          }
                      ]
                  }
              }
          ];
          
          const analyzer = new CrsAnalyzer(context, cli);
      
          await analyzer.analyze();
          
          const publisher = new CrsPublisher(analyzer, new GithubClient(), context);

          const driftBody = await publisher.buildDriftBody(analyzer.drifted[0]);

          const expectedBody =
`
The claim 'test' with kind: TFWorkspace has a drift.

<details id=drift>
  <summary>DRIFT</summary>

\`\`\`json
{
  "create": [
    "azurerm_management_lock.subscription_level"
  ]
}
\`\`\`
</details>
`
        expect(driftBody).toEqual(expectedBody);

    })
    

    it("Is able to build the error pr body correctly", async () => {
  
          const context = new Context(
              "firestartr.dev",
              "v1",
              "terraformworkspaces", 
              "default",
              "org",
              "repo"
          );
  
          const cli = new MockKubernetesClient()
  
          resolvedValue = [
              {
                  metadata: {
                      name: "test",
                      annotations: {
                        "firestartr.dev/claim-ref": "TFWorkspace/test"
                      }
                  },
                  status: {
                      conditions: [
                          {
                              type: "ERROR",
                              status: "True",
                              message: "error"
                          }
                      ]
                  }
              }
          ];
          
          const analyzer = new CrsAnalyzer(context, cli);
      
          await analyzer.analyze();
          
          const publisher = new CrsPublisher(analyzer, new GithubClient(), context);

          const errorBody = await publisher.buildErrorsBody(analyzer.failed[0]);

          const expectedBody =
`
The claim 'test' with kind: TFWorkspace has an error.

<details id=error>
  <summary>ERROR LOG</summary>

\`\`\`shell
error
\`\`\`
</details>
`
            expect(errorBody).toEqual(expectedBody);

        })

  })
  
