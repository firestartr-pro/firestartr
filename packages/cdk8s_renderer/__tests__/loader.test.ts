import { setExcludedPaths, setPath } from '../src/config';
import {
  loadGlobals, loadInitializers, loadOverrides,
   loadCRs, loadClaimDefaults, loadClaimsList
} from '../src/loader/loader';
import { resetLazyLoader } from '../src/loader/lazy_loader';
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
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

  it("caches initializers per run and re-reads them after a reset", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "init-cache-"));
    const file = path.join(dir, "defaults_github_repository.yaml");

    const writeInitializer = (value: string) => {
      fs.writeFileSync(file, [
        "name: repo_base",
        "apiVersion: firestartr.dev/v1",
        "kind: ComponentClaim",
        "defaultValues:",
        "  context:",
        `    value: ${value}`,
      ].join("\n"));
    };

    try {
      writeInitializer("first");
      const firstLoad: any[] = await loadInitializers(claim, undefined, dir);
      expect(firstLoad[0].data.context.value).toEqual("first");

      // Editing the file mid-run does not invalidate the per-run cache...
      writeInitializer("second");
      const cachedLoad: any[] = await loadInitializers(claim, undefined, dir);
      expect(cachedLoad[0].data.context.value).toEqual("first");

      // ...but resetting the render state drops the cache and re-reads the file.
      resetLazyLoader();
      const refreshedLoad: any[] = await loadInitializers(claim, undefined, dir);
      expect(refreshedLoad[0].data.context.value).toEqual("second");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("builds independent initializer instances and data per call", async () => {
    const dir = path.join(__dirname, "fixtures/initializers");

    const firstLoad: any[] = await loadInitializers(claim, undefined, dir);
    const secondLoad: any[] = await loadInitializers(claim, undefined, dir);

    // Fresh instances, not a shared cached one.
    expect(firstLoad[0]).not.toBe(secondLoad[0]);

    const snapshot: any = JSON.parse(JSON.stringify(secondLoad[0].data));

    // Mutating one claim's defaults must not leak into another claim's.
    firstLoad[0].data.injected = "mutation";
    firstLoad[0].data.firestartr.technology.stack = "python";

    expect(secondLoad[0].data).not.toHaveProperty("injected");
    expect(secondLoad[0].data.firestartr.technology.stack).toEqual("node");
    expect(secondLoad[0].data).toEqual(snapshot);
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
