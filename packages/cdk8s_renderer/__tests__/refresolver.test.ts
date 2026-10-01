import {
  setRenderedClaim,
  resolveClaimRef,
  setPreviousClaimsSymbols,
  emptyRenderedClaims,
} from "../src/refresolver";


const CR1: any = { a: "a" };
const CR2: any = { b: "b" };
const CR3: any = { c: "c" };
const CR4: any = { d: "d" };
const CR5: any = { e: "e" };

const CLAIM1: any = { name: "name1", kind: "Kind1" };
const CLAIM2: any = { name: "name2", kind: "Kind1" };
const CLAIM3: any = { name: "name3", kind: "Kind1" };
const CLAIM4: any = { name: "name1", kind: "Kind2" };
const CLAIM5: any = { name: "name1", kind: "Kind3" };


describe("The reference resolver", () => {

  it("can set a claim object to use later to reference claims", () => {

    setRenderedClaim(CLAIM1, CR1);
    setRenderedClaim(CLAIM2, CR2);
    setRenderedClaim(CLAIM3, CR3);
    setRenderedClaim(CLAIM4, CR4);
    setRenderedClaim(CLAIM5, CR5);

  });

  it("can resolve references", () => {

    const resolvedRef1: any = resolveClaimRef("Kind1", "name2");
    expect(resolvedRef1).toEqual(CR2);

    const resolvedRef2: any = resolveClaimRef("Kind2", "name1");
    expect(resolvedRef2).toEqual(CR4);

    const resolvedRef3: any = resolveClaimRef("Kind1", "name3");
    expect(resolvedRef3).toEqual(CR3);

  });

  it("throws an error on invalid references", () => {

    expect(() => resolveClaimRef("Kind1", "name7")).toThrow();
    expect(() => resolveClaimRef("Kind5", "name1")).toThrow();
    expect(() => resolveClaimRef("Kind4", "name5")).toThrow();

  });

  it("falls back to previous claims symbols when the claim is not rendered in this run", () => {

    emptyRenderedClaims();

    const previousUserCr: any = {
      kind: "FirestartrGithubMembership",
      metadata: { name: "user-b-uuid" },
    };

    setPreviousClaimsSymbols({
      "UserClaim-user-b": previousUserCr,
    });

    expect(resolveClaimRef("UserClaim", "user-b")).toEqual(previousUserCr);
  });

  it("prefers rendered claims over previous claims symbols", () => {

    emptyRenderedClaims();

    setRenderedClaim(CLAIM1, CR1);

    setPreviousClaimsSymbols({
      "Kind1-name1": CR2,
    });

    expect(resolveClaimRef("Kind1", "name1")).toEqual(CR1);
  });

  it("clears previous claims symbols when emptying rendered claims", () => {

    emptyRenderedClaims();

    setPreviousClaimsSymbols({
      "UserClaim-user-b": CR1,
    });

    emptyRenderedClaims();

    expect(() => resolveClaimRef("UserClaim", "user-b")).toThrow(
      "Claim UserClaim-user-b not found",
    );
  });

  it("does not fall back to previous claims symbols for custom symbols tables", () => {

    emptyRenderedClaims();

    setPreviousClaimsSymbols({
      "UserClaim-user-b": CR1,
    });

    expect(() =>
      resolveClaimRef("UserClaim", "user-b", {}),
    ).toThrow("Claim UserClaim-user-b not found");
  });

});
