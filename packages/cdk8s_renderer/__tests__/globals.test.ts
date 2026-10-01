import Doppleman from "./fixtures/k8s_doppleman";
import { GlobalDefault } from "../src/defaults/global";
import { ICustomResourcePatch } from "../src/patches";


const EMPTY_CLAIM: any = { spec: {} };


describe("The globals", () => {

  it("correctly apply global values, overriding the previousCR and the claim", async () => {
    const config: any = { globalValues: { a: 24, b: "erizo" } };
    const previousCR: any = { spec: { a: 25, b: "equidna" } };
    const claim: any = { spec: { a: 26, b: "zorro" } };
  
    // first defintion (no claim no previousCR)
    let patches:ICustomResourcePatch[] = await new GlobalDefault(
      config
    ).patches({}, {});

    let doppleman: Doppleman = new Doppleman(EMPTY_CLAIM, patches)
    doppleman.set("provider", "github")

    expect((await doppleman.render())).toEqual({
      spec: config.globalValues
    });

    // second defintion (no claim yes previousCR)

    doppleman = new Doppleman(EMPTY_CLAIM, patches)
    doppleman.set("provider", "github")

    patches = await new GlobalDefault(config).patches({}, previousCR);
    expect((await doppleman.render())).toEqual({
      spec: config.globalValues
    });

    // third defintion (yes claim yes previousCR)
    doppleman = new Doppleman(claim, patches)
    doppleman.set("provider", "github")

    patches = await new GlobalDefault(config).patches({}, previousCR);
    expect((await doppleman.render())).toEqual({
      spec: config.globalValues
    });

    // Check the identify method also works (the validate method is checked
    // within the render function)
    expect(patches[0].identify()).toEqual("defaults/global");
  })

  it("'s other functions also work properly", async () => {
    const validConfig: any = { globalValues: { a: 33, b: "conejo" } };
    const invalidConfig: any = { thisHasNoGlobalValues: true };
    const CR: any = { spec: { b: "gato", c: null } };
    const schema: any = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { globalValues: { type: "object" } },
      additionalProperties: true,
    };

    // Throws an error when given an invalid config
    expect(() => new GlobalDefault(invalidConfig)).toThrow();

    const validGlobal: GlobalDefault = new GlobalDefault(validConfig); 
    const desiredPatches: any[] = validGlobal.__getDesiredPatches(
      CR, validConfig.globalValues
    );
    expect(desiredPatches.length).toEqual(2);
    expect(desiredPatches[0].op).toEqual("replace");
    expect(desiredPatches[1].op).toEqual("add");

    const isValid: boolean = await validGlobal.validate(schema);
    expect(isValid).toEqual(true);
  });

})
