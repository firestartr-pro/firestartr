import {
  AllowedPathNames, getPath, setPath, setExcludedPaths, getAdditionalPaths,
  getRenamesEnabled, setRenamesEnabled, AllowedProviders, configureProvider,
  getConfiguredProvider, getSelectedKindClaimCrMap
} from "../src/config";


describe("The config file", () => {

  it("has functions to set and get paths", () => {

    const allowedPathsList: string[] = [
      "initializers", "globals", "crs", "claims",
      "claimsDefaults", "domains", "systems", ".github"
    ];

    for(const pathName in allowedPathsList) {
      const pathValue: string = `test-${pathName}-path`;
      setPath(pathName as AllowedPathNames, pathValue);
      expect(getPath(pathName as AllowedPathNames)).toEqual(pathValue);
    }

  });

  it("throws an error when setting or getting an invalid path", () => {

    expect(() => getPath("test" as AllowedPathNames)).toThrow("test path not set");

  });

  it("has functions to set and get excluded paths", () => {

    const excludedPathListA: string[] = ["path1", "path2"];
    const excludedPathListB: string[] = ["path3", "path4"];

    // Works when no previous paths were excluded
    setExcludedPaths(excludedPathListA);
    expect(getAdditionalPaths()).toEqual(excludedPathListA);

    // Replaces (not accumulates) when called again
    setExcludedPaths(excludedPathListB);
    expect(getAdditionalPaths()).toEqual(excludedPathListB);

    // Can be cleared by passing an empty array
    setExcludedPaths([]);
    expect(getAdditionalPaths()).toEqual([]);

  });

  it("has functions to enable and disable renames", () => {

    setRenamesEnabled(true);
    expect(getRenamesEnabled()).toEqual(true);

    setRenamesEnabled(false);
    expect(getRenamesEnabled()).toEqual(false);

  });

  it("throws an error when trying to get an unconfigured provider", () => {

    expect(() => getConfiguredProvider()).toThrow(
      `No provider configured, please call configureProvider()`
    );

  });

  it("can configure a provider", () => {

    configureProvider(AllowedProviders.github);
    expect(getConfiguredProvider()).toEqual(AllowedProviders.github);

  });

  it("throws an error when trying to set a configured provider", () => {

    expect(() => configureProvider(AllowedProviders.all)).toThrow(
      `Provider github already configured`
    );

  });

  it("can get the CR map for the current provider", () => {

    expect(getSelectedKindClaimCrMap()).toEqual({
      "GroupClaim": "FirestartrGithubGroup",
      "UserClaim": "FirestartrGithubMembership",
      "ComponentClaim": "FirestartrGithubRepository",
    });

  });

});
