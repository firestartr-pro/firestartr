import Doppleman from "./fixtures/k8s_doppleman";
import { loadYamlFixture } from "./fixtures/utils";
import { InitializerDefault } from "../src/defaults/initializer";
import { ICustomResourcePatch } from "../src/patches";
import * as _ from "lodash";


const GITHUB_REPOSITORY_DEFAULTS_PATH: string ="initializers/defaults_github_repository.yaml";
const EMPTY_CLAIM: any = { spec: {} };


describe("The initializers", () => {

  it(
    "correctly apply defaults whether they come from a config, the previous CR or the claim",
    async () => {
      const config: any = { defaultValues: { a: 24, b: "erizo" } };
      const previousCR: any = { spec: { a: 25, b: "equidna" } };
      const claim: any = { spec: { a: 26, b: "zorro" } };
    
      // first defintion (no claim no previousCR)
      let patches: ICustomResourcePatch[] = await new InitializerDefault(
        config
      ).patches({}, {});

      let doppleman: Doppleman = new Doppleman(EMPTY_CLAIM, patches)
      doppleman.set("provider", "github")

      expect((await doppleman.render())).toEqual({
        spec: config.defaultValues
      });

      // second defintion (no claim yes previousCR)
      // We added previousCR to the doppleman, because it uses it to apply it as if it was the previousCR
      doppleman = new Doppleman(previousCR, patches)
      doppleman.set("provider", "github")

      patches = await new InitializerDefault(config).patches({}, previousCR);
      expect((await doppleman.render())).toEqual(previousCR);


      // third defintion (yes claim yes previousCR)
      doppleman = new Doppleman(claim, patches)
      doppleman.set("provider", "github")
      patches = await new InitializerDefault(config).patches({}, previousCR);
      expect((await doppleman.render())).toEqual(claim);

      // Check the identify method also works (the validate method is checked
      // within the render function)
      expect(patches[0].identify()).toEqual("defaults/initializer");
    }
  )

  it("correctly merge previous CR and config values, when necessary", async () => {
    const config: any = await loadYamlFixture(GITHUB_REPOSITORY_DEFAULTS_PATH);
    const previousCR: any = await loadYamlFixture(GITHUB_REPOSITORY_DEFAULTS_PATH);

    // For the previousCR, the data is stored under spec, not defaultValues
    previousCR.spec = previousCR.defaultValues;

    // Remove a field from the previousCR to check it'll be added back when
    // the initializers are applied
    delete previousCR.spec.repo;

    const patches:ICustomResourcePatch[] = await new InitializerDefault(
      config
    ).patches({}, _.cloneDeep(previousCR)); // We clone it to avoid reference errors

    let doppleman: Doppleman = new Doppleman(EMPTY_CLAIM, patches)
    doppleman.set("provider", "github")

    const result: any = await doppleman.render();
    expect(result.spec.repo).toEqual(config.defaultValues.repo);
    expect(previousCR.spec.repo).toBeUndefined();
  })

  it("'s other functions also work properly", async () => {
    const validConfig: any = { defaultValues: { a: 33, b: "conejo" } };
    const invalidConfig: any = { thisHasNoDefaultValues: true };
    const CR: any = { spec: { b: "gato", c: null } };
    const schema: any = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { defaultValues: { type: "object" } },
      additionalProperties: true,
    };

    // Throws an error when given an invalid config
    expect(() => new InitializerDefault(invalidConfig)).toThrow();

    const validInitializer: InitializerDefault = new InitializerDefault(validConfig); 
    const desiredPatches: any[] = validInitializer.__getDesiredPatches(
      CR, validConfig.defaultValues
    );
    expect(desiredPatches.length).toEqual(1);
    expect(desiredPatches[0].op).toEqual("add");

    const isValid: boolean = await validInitializer.validate(schema);
    expect(isValid).toEqual(true);
  });

})
