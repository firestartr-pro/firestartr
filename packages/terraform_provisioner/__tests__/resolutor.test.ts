import { resolveRef, getRefNameFromKey, resolveScalar, resolveValues } from "../src/resolutor";

describe("The reference resolutor", () => {

  const references: any = {
    "test-a": "value-a",
    "test-b": "value-b",
    "test-c": "value-c",
    "test-d": "value-d",
    "interpolable-value": "interpolable",
    "not-interpolable-value": 12345,
  };

  it('is able get ref name from key', () => {

      const key = "${{ references.example }}"

      const expectedRefName = "example"

      expect(getRefNameFromKey(key)).toEqual(expectedRefName);

  });

  it("can resolve an existing key", () => {

    expect(
      resolveRef("${{references.test-a}}", references, false)
    ).toEqual(references["test-a"]);

    expect(
      resolveRef("${{references.test-b}}", references, false)
    ).toEqual(references["test-b"]);

    expect(
      resolveRef("${{references.test-c}}", references, false)
    ).toEqual(references["test-c"]);

    expect(
      resolveRef("${{references.test-d}}", references, false)
    ).toEqual(references["test-d"]);

  });

  it("can manage invalid keys", () => {
    
    expect(() =>
      resolveRef("${{references.test-e}}", references, false)
    ).toThrow("KEY NOT FOUND");

  });

  it("can manage invalid patterns", () => {
    
    expect(() =>
      resolveRef("references.test-a}}", references, false)
    ).toThrow("INVALID REFERENCE KEY FORMAT");
    
    expect(() =>
      resolveRef("${{references.test-a", references, false)
    ).toThrow("INVALID REFERENCE KEY FORMAT");
    
    expect(() =>
      resolveRef("${{refere.test-a}}", references, false)
    ).toThrow("INVALID REFERENCE KEY FORMAT");

  });

  it("can check if a value wants interpolation", () => {

    expect(
      resolveRef("${{references.interpolable-value}}", references, true)
    ).toEqual(references["interpolable-value"]);

    expect(
      resolveRef("${{references.not-interpolable-value}}", references, false)
    ).toEqual(references["not-interpolable-value"]);
    
    expect(() =>
      resolveRef("${{references.not-interpolable-value}}", references, true)
    ).toThrow("VALUE NOT INTERPOLABLE");

  });

  it("can correctly resolve scalar values without references", () => {

    expect(resolveScalar(12345, references)).toEqual(12345);
    expect(resolveScalar(98.765, references)).not.toEqual("98.765");
    expect(resolveScalar(98.765, references)).toEqual(98.765);

    expect(resolveScalar(true, references)).not.toEqual("true");
    expect(resolveScalar(true, references)).toEqual(true);

    expect(resolveScalar("string", references)).toEqual("string");
    expect(resolveScalar("true", references)).not.toEqual(true);
    expect(resolveScalar("true", references)).toEqual("true");
    expect(resolveScalar("123", references)).not.toEqual(123);
    expect(resolveScalar("123", references)).toEqual("123");

  });

  it("preserves null values when resolving objects", () => {
    expect(resolveValues({ actor_id: null }, references)).toEqual({ actor_id: null });
    expect(resolveValues([null], references)).toEqual([null]);
  });

  it("can correctly resolve simple and complex references", () => {

    expect(
      resolveScalar("${{references.test-a}}", references)
    ).toEqual(references["test-a"]);

    expect(
      resolveScalar("${{references.test-b}}-concatenated", references)
    ).toEqual(`${references["test-b"]}-concatenated`);

    expect(
      resolveScalar("concatenation-${{references.test-c}}", references)
    ).toEqual(`concatenation-${references["test-c"]}`);

    expect(
      resolveScalar("${{references.test-a}}-${{references.test-b}}", references)
    ).toEqual(`${references["test-a"]}-${references["test-b"]}`);

    expect(
      resolveScalar("test-${{references.test-a}}-test-${{references.test-b}}-test", references)
    ).toEqual(`test-${references["test-a"]}-test-${references["test-b"]}-test`);

  });

});
