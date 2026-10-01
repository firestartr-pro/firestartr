import { setExcludedPaths, setPath } from '../src/config';
import {
  loadGlobals, loadInitializers, loadOverrides,
   loadCRs, loadClaimDefaults, loadClaimsList
} from '../src/loader/loader';
import * as path from "path";
import * as fs from "fs";
import common from "catalog_common";

import {
  claimsRefListAsGenerator,
} from '../src/utils/claimUtils';


import {createTestContext} from "./auxiliar";

describe("The loaders", () => {

  let context = null

  let claim: any = null

  jest.setTimeout(30000);

  process.env['ORG'] = 'firestartr-test'

  beforeAll(async () => {
  
      context = await createTestContext({})

      claim = common.io.fromYaml(
      
          await context.getFile("component_a")
      );
  })

  beforeEach(async () => {
  
      await context.restart();
  
  })


  it("fails if the corresponding paths have not been set", async () => {
    try {
      await loadGlobals({}).then((result: any) => result);
      throw "Error: loadGlobals() did not throw with no path specified";
    } catch(e: any) {
      expect(e.message).toEqual("globals path not set")
    }
    try {
      await loadInitializers({}).then((result: any) => result);
      throw "Error: loadInitializers() did not throw with no path specified";
    } catch(e: any) {
      expect(e.message).toEqual("initializers path not set")
    }
    try {
      loadClaimDefaults();
      throw "Error: loadClaimDefaults() did not throw with no path specified";
    } catch(e: any) {
      expect(e.message).toEqual("claimsDefaults path not set")
    }
    try {
      await loadCRs().then((result: any) => result);
      throw "Error: loadCRs() did not throw with no path specified";
    } catch(e: any) {
      expect(e.message).toEqual("crs path not set")
    }
  });

  it("can correctly load globals", async () => {
    const expectedResult: any = common.io.fromYaml(fs.readFileSync(
      path.join(__dirname, "fixtures/globals/expander_branch_strategies.yaml"), "utf-8"
    ))
    setPath("globals", path.join(__dirname, "fixtures/globals"));
    const result: any[] = await loadGlobals(claim).then((result: any) => result);
    expect(result[0].data.values).toEqual(expectedResult.expanderValues);
  });

  it("can correctly load initializers", async () => {
    const expectedResult: any = common.io.fromYaml(fs.readFileSync(
      path.join(__dirname, "fixtures/initializers/defaults_github_repository.yaml"), "utf-8"
    ))
    setPath("initializers", path.join(__dirname, "fixtures/initializers"));
    const result: any[] = await loadInitializers(claim).then((result: any) => result);
    expect(result[0].data).toEqual(expectedResult.defaultValues);
  });

  it("can correctly load overrides", async () => {
    const result: any[] = loadOverrides(claim);
    expect(result.length).toEqual(1);
  });

  it("can correctly load claims", async () => {
    
    setPath("claims", await context.getClaimsDir());
    
    setPath("claimsDefaults", path.join(__dirname, "fixtures/initializers"));

    setPath("initializers", path.join(__dirname, "fixtures/initializers"));

    setPath("globals", path.join(__dirname, "fixtures/globals"));

    setPath("crs", await context.getBaseCrsDir());

    const result: any = await loadClaimsList(
        
        await claimsRefListAsGenerator(["ComponentClaim-component_a"]),

        await context.getClaimsDir()
    
    ).then((result: any) => result);

    const resultingClaimObject: any = result.renderClaims["ComponentClaim-component_a"];

    // Remove patches
    delete resultingClaimObject.claim.providers.github["features"];
    delete resultingClaimObject.claim.providers.github["repo"];
    delete resultingClaimObject.claim.providers.github["technology"];

    expect(resultingClaimObject.globals).toBeDefined();
    expect(resultingClaimObject.initializers).toBeDefined();
    expect(resultingClaimObject.overrides).toBeDefined();
    expect(resultingClaimObject.claimPath).toEqual(
      await context.getFilePath("component_a")
    );
    expect(resultingClaimObject.claim).toEqual(claim);
  });

  it("can correctly load CRs", async () => {
    setPath("crs", path.join(__dirname, "fixtures/crs"));
    setExcludedPaths([ path.join(__dirname, "fixtures/crs/.github")])
    const result: any = await loadCRs().then((result: any) => result);
    expect(result[`FirestartrGithubRepository-test-catalog`]).toBeDefined();
  });

  it("can correctly load claim defaults", async () => {
    const expectedResult: any = common.io.fromYaml(fs.readFileSync(
      path.join(__dirname, "fixtures/initializers/claims_defaults.yaml"), "utf-8"
    ))
    setPath("claimsDefaults", path.join(__dirname, "fixtures/initializers"));
    const result: any = loadClaimDefaults();
    expect(result).toEqual(expectedResult);
  });

  it("can correctly load a list of claims", async () => {
    setPath("claims", await context.getClaimsDir());
    setPath("claimsDefaults", path.join(__dirname, "fixtures/initializers"));
    setPath("initializers", path.join(__dirname, "fixtures/initializers"));
    setPath("globals", path.join(__dirname, "fixtures/globals"));
    setPath("crs", await context.getBaseCrsDir());
    const claimsToRenderList: string[] = [
      'ComponentClaim-component_a',
      'GroupClaim-group_a',
    ]

    const result: any = await loadClaimsList(await claimsRefListAsGenerator(claimsToRenderList));

    expect(result.renderClaims).toBeDefined();
    expect(result.crs).toBeDefined();

    for (const claimName of claimsToRenderList) {
      expect(result.renderClaims[claimName]).toBeDefined();
    }

    expect(result.crs['FirestartrGithubGroup-group-a']).toBeDefined();
  });

  it("throws an error when the list of claims to load has an invalid claim", async () => {
    setPath("claims", await context.getClaimsDir());
    setPath("claimsDefaults", path.join(__dirname, "fixtures/initializers"));
    setPath("initializers", path.join(__dirname, "fixtures/initializers"));
    setPath("globals", path.join(__dirname, "fixtures/globals"));
    setPath("crs", await context.getBaseCrsDir());
    const claimsToRenderList: string[] = [
      'ComponentClaim-test-catalog-3',
      'UserClaim-fake-user',
      'GroupClaim-before-rename',
    ]

    let error = "";

    try {
      await loadClaimsList(await claimsRefListAsGenerator(claimsToRenderList));
    } catch(err) {
      error = err;
    }
    expect(error.includes('UserClaim-fake-user'));

    try {
      await loadClaimsList(await claimsRefListAsGenerator(['ComponentClaim-test-catalog-87']));
    } catch(err) {
      error = err;
    }
    expect(error.includes('UserClaim-user-c'));
  });

  it("can correctly load a list of claims, even with circular dependencies", async () => {

    await context.applyPatches(
    
        "group_a",

        [{op: "add", path: "/parent", value: "group:group_b"}]
    )


    setPath("claims", await context.getClaimsDir());
    setPath("claimsDefaults", path.join(__dirname, "fixtures/initializers"));
    setPath("initializers", path.join(__dirname, "fixtures/initializers"));
    setPath("globals", path.join(__dirname, "fixtures/globals"));
    setPath("crs", await context.getBaseCrsDir());
    const claimsToRenderList: string[] = [
      'GroupClaim-group_a',
      'GroupClaim-group_b',
    ]

    const result: any = await loadClaimsList(await claimsRefListAsGenerator(claimsToRenderList));

    expect(result.renderClaims).toBeDefined();
    expect(result.crs).toBeDefined();

    for (const claimName of claimsToRenderList) {
      expect(result.renderClaims[claimName]).toBeDefined();
    }

    expect(result.crs['FirestartrGithubMembership-user-a-github']).toBeDefined();
  });

});
