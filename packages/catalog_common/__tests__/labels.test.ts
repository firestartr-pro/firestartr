import { getFirestartrLabel } from "../src/generic/labels";

describe("The labels helper", () => {

  it("can create a label", () => {
    const labelName: string = "test";
    const fullLabel: string = getFirestartrLabel(labelName);

    expect(fullLabel).toEqual(`firestartr.dev/${labelName}`);
  });

  it("can normalize a name and create a label", () => {
    const labelName: string = "un-_normALI$ed l4b3l==ñam?e";
    const fullLabel: string = getFirestartrLabel(labelName);

    expect(fullLabel).toEqual(`firestartr.dev/un--normali-ed-l4b3l---am-e`);
  });

  it("can normalize a name (including its length) and create a label", () => {
    const labelName: string = "_".repeat(60) + "abcdefghijklm";
    const fullLabel: string = getFirestartrLabel(labelName);

    expect(fullLabel).toEqual(`firestartr.dev/${"-".repeat(60) + "abcd"}`);
  });

});

