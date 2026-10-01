import Doppleman from "./fixtures/k8s_doppleman";
import { loadYamlFixture } from "./fixtures/utils";
import { BranchStrategiesInitializer } from "../src/initializers/branchStrategies";
import { ICustomResourcePatch } from "../src/patches";


const config: any = loadYamlFixture("initializers/branch_strategies.yaml");
const BASE_CLAIM: any = { metadata: { annotations: {} }, spec: { repo: {} } };
let patches: ICustomResourcePatch[];


describe("The branch strategies logic", () => {
  it("can correctly expand an existing branchStrategy into its correct values", async () => {
    patches = await new BranchStrategiesInitializer(config).patches(
      { providers: { github: { branchStrategy: {name: "trunkBasedDevelopment" } } } }, {}
    );

    let doppleman: Doppleman = new Doppleman(BASE_CLAIM, patches)
    doppleman.set("provider", "github")

    expect((await doppleman.render())).toEqual({
      metadata: { annotations: {} },
      spec: {
        branchProtections: config.defaultValues.strategies[0].values.branchProtections,
        repo: {
          defaultBranch: config.defaultValues.strategies[0].values.defaultBranch,
        }
      }
    });
  });

  it("can correctly expand a different branchStrategy into its correct values", async () => {
    patches = await new BranchStrategiesInitializer(config).patches(
      { providers: { github: { branchStrategy: {name: "gitflow"}} } }, {}
    );

    let doppleman: Doppleman = new Doppleman(BASE_CLAIM, patches)
    doppleman.set("provider", "github")

    expect((await doppleman.render())).toEqual({
      metadata: { annotations: {} },
      spec: {
        branchProtections: config.defaultValues.strategies[2].values.branchProtections,
        repo: {
          defaultBranch: config.defaultValues.strategies[2].values.defaultBranch,
        }
      }
    });
  });

  it(
    "can correctly expand the branchStrategy 'none', even though it's not defined in branch_strategies.yaml",
    async () => {
      patches = await new BranchStrategiesInitializer(config).patches(
        { providers: { github: { branchStrategy: {name: "none"} } } }, {}
      );

      let doppleman: Doppleman = new Doppleman(BASE_CLAIM, patches)
      doppleman.set("provider", "github")

      expect((await doppleman.render())).toEqual({
        metadata: { annotations: {} },
        spec: { branchProtections: [], repo: { defaultBranch: undefined } }
      });
    }
  );

  it(
    "can correctly set the defaultBranch when specified in the claim and using branchStrategy=none",
    async () => {
      // If a defaultBranch is specified when using branchStrategy = none,
      // then that will be the defaultBranch of the CR
      patches = await new BranchStrategiesInitializer(config).patches(
        { providers: { github: { branchStrategy: {name: "none"} , defaultBranch: "test" } } }, {}
      );

      let doppleman: Doppleman = new Doppleman(BASE_CLAIM, patches)
      doppleman.set("provider", "github")

      expect((await doppleman.render())).toEqual({
        metadata: { annotations: {} },
        spec: { branchProtections: [], repo: { defaultBranch: "test" } }
      });
    }
  );

  it("throws an error when specifying a non existent branchStrategy", async () => {
    expect(new BranchStrategiesInitializer(config).patches(
      { providers: { github: { branchStrategy: {name: "doesntExist"} } } }, {}
    )).rejects.toThrow();
  })
})
