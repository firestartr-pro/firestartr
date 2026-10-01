import { CrsAnalyzer } from "../src/analyzers/crs-analyzer";
import { Context } from "../src/context";
import {KubernetesClient} from "../src/kubernetes-client";

jest.mock("../src/kubernetes-client", () => ({
    KubernetesClient: jest.fn().mockImplementation(() => ({

        constructor(){
        
        },

        listKind(){

            return {
                metadata: {
                    name: "test",
                },
                status: {
                    conditions: [
                        {
                            type: "OUT_OF_SYNC",
                            status: "True",
                        }
                    ]
                }
            }
        }
    }))
}));


describe("Workspace analyzer", () => {

    let MockKubernetesClient = null

    beforeEach(() => {
    
       MockKubernetesClient = KubernetesClient as jest.MockedClass<typeof KubernetesClient>;
    
    })

    it("Is able to detect drift", async () => {
  
          const context = new Context(
              "firestartr.dev",
              "v1",
              "terraformworkspaces", 
              "default",
              "org",
              "repo"
          );
  
          const cli = new MockKubernetesClient()
  
          cli.listKind = jest.fn().mockResolvedValue([
              {
                  metadata: {
                      name: "test",
                  },
                  status: {
                      conditions: [
                          {
                              type: "OUT_OF_SYNC",
                              status: "True",
                          }
                      ]
                  }
              }
          ]);
          
          const analyzer = new CrsAnalyzer(context, cli);
      
          await analyzer.analyze();
      
          expect(analyzer.drifted.length).toBeGreaterThan(0);
    })
  
      it("Is able to detect failed", async () => {
      
          const context = new Context(
              "firestartr.dev",
              "v1",
              "terraformworkspaces", 
              "default",
              "org",
              "repo"
          );
      
          const cli = new MockKubernetesClient()
      
          cli.listKind = jest.fn().mockResolvedValue([
              {
                  metadata: {
                      name: "test",
                  },
                  status: {
                      conditions: [
                          {
                              type: "ERROR",
                              status: "True",
                          }
                      ]
                  }
              }
          ]);
          
          const analyzer = new CrsAnalyzer(context, cli);
      
          await analyzer.analyze();
      
          expect(analyzer.failed.length).toBeGreaterThan(0);
      })
  
      it("Is able to list workspaces", async () => {
      
          const context = new Context(
              "firestartr.dev",
              "v1",
              "terraformworkspaces", 
              "default",
              "org",
              "repo"
          );
      
          const cli = new MockKubernetesClient()
      
          cli.listKind = jest.fn().mockResolvedValue([
              {
                  metadata: {
                      name: "test",
                  },
                  status: {
                      conditions: [
                          {
                              type: "OUT_OF_SYNC",
                              status: "True",
                          }
                      ]
                  }
              }
          ]);
          
          const analyzer = new CrsAnalyzer(context, cli);
      
          const workspaces = await analyzer.listCrs();
      
          expect(workspaces.length).toBeGreaterThan(0);
      })
  
})
