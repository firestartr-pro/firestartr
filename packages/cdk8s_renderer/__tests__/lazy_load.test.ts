import { setExcludedPaths, setPath } from '../src/config';
import { loadClaim, resetLazyLoader } from '../src/loader/lazy_loader';
import {
  isYamlFile,
  patchClaim,
  loadInitializers,
  loadGlobals,
  loadOverrides,
  loadNormalizers,
} from '../src/loader/loader';
import * as path from "path";
import * as fs from "fs";
import common from "catalog_common";

import {createTestContext} from "./auxiliar";

setPath("claimsDefaults", path.join(__dirname, "fixtures/initializers"));
setPath("initializers", path.join(__dirname, "fixtures/initializers"));
setPath("globals", path.join(__dirname, "fixtures/globals"));

async function __test_lazy_loader(claimRef: string, resultPath: string) {
  const [result] = await loadClaim(
    claimRef,
    'firestartr-test',
    {
      ComponentClaim: {
        platformOwner: "group:my-team",
      },
    },
    patchClaim,
    loadInitializers,
    loadGlobals,
    loadOverrides,
    loadNormalizers,
    path.join(__dirname, "fixtures/claims")
  );
  const expectedResult = JSON.parse(
    fs.readFileSync(path.join(__dirname, resultPath), 'utf-8')
  );

  expect(Object.keys(result)).toEqual(expectedResult);
}

describe("The lazy load", () => {

  let context = null

  beforeAll(async () => {
  
      context = await createTestContext({})
  
  })

  beforeEach(async () => {

    resetLazyLoader()

	await context.restart()

  })

  async function __test_load(claimRef: string, results: string[]){
    
    const [result] = await loadClaim(
      claimRef,
      'firestartr-test',
      {
        ComponentClaim: {
          platformOwner: "group:my-team",
        },
      },
      patchClaim,
      loadInitializers,
      loadGlobals,
      loadOverrides,
      loadNormalizers,
      await context.getClaimsDir()
    );

    expect(Object.keys(result).filter((k) => results.includes(k)).length).toEqual(results.length)
  }

  it("can load a component claim and it's references", async () => {
    await __test_load(
      "ComponentClaim-component_a",
      [
        "ComponentClaim-component_a",
        "UserClaim-user_a",
        "GroupClaim-group_a",
        "GroupClaim-group_b",
        "SystemClaim-system_a",
        "DomainClaim-domain_a"
      ]
    );
  });

  it("can load a group claim and it's references", async () => {
    await __test_load(
      "GroupClaim-group_c",
      [
		
        "GroupClaim-group_a",
        "GroupClaim-group_b",
        "GroupClaim-group_c",
        "UserClaim-user_a",
      ]
    );
  });

  it("can load an user claim and it's references", async () => {
    await __test_load(
      "UserClaim-user_a",
	   ["UserClaim-user_a"]
    );
  });

  it("can load a TFWorkspace claim and it's references", async () => {
    await __test_load(
      "TFWorkspaceClaim-workspace_a",
	   [
	    'TFWorkspaceClaim-workspace_a',
        'GroupClaim-firestartr-test-all',
        'SystemClaim-system_a',
        'DomainClaim-domain_a',
        'UserClaim-user_a',
        'SecretsClaim-secret_a',
        'TFWorkspaceClaim-workspace_b'
       ]
    );
  });

  it("can load a system claim and it's references", async () => {
    await __test_load(
      "SystemClaim-system_a",
	   [
        'SystemClaim-system_a',
        'DomainClaim-domain_a',
        'UserClaim-user_a',
       ]
    );
  });

  it("throws an error when a claim can't be found", async () => {

    let error = ""

	try{
		await __test_load(
			"ComponentClaim-fake",
			[]
		);
	}
    catch(err){
        error = err
    }

    expect(error.includes("Lazy Loading: Error: Error: ComponentClaim-fake not found"))

  });

  it("throws an error when a dependency can't be found", async () => {

    let error = ""

	await context.removeFile("user_a")

    try{
		await __test_load(
			"ComponentClaim-component_a",
			[
			]
		);
    }
    catch(err){
        error = err
    }

    expect(error.includes("Lazy Loading: Lazy Loading: Error: Error: UserClaim-user_a not found"))

  });

  it("can load a virtual claim and it's references", async () => {

	await context.applyPatches(

		"component_a",

		[
			{op: "replace", path: "/owner", value: "group:firestartr-test-all"}
		]

	)


	await __test_load(

		"ComponentClaim-component_a",
		[
			'ComponentClaim-component_a',
			'SystemClaim-system_a',
			'DomainClaim-domain_a',
			'UserClaim-user_a',
			'GroupClaim-firestartr-test-all',
			'GroupClaim-group_a',
			'GroupClaim-group_b'
		]
	);

  });

  it("can detect duplicated claims and throw errors", async () => {

	await context.duplicateFile(

		"group_a",
		"group_a_copy"

	)

    let error = ""
    try{
      await loadClaim(
        "GroupClaim-group_a",
        'firestartr-test',
        {
          ComponentClaim: {
            platformOwner: "group:my-team",
          },
        },
        patchClaim,
        loadInitializers,
        loadGlobals,
        loadOverrides,
        loadNormalizers,
		await context.getClaimsDir()
      )
    }
    catch(err){
     error = err
    }

    expect(error.includes(
      "Duplicated claim GroupClaim-group_a found files: "
    )).toEqual(true)

  })

  it("throws an error when a claim cannot be validated", async () => {

	await context.applyPatches(

		"secret_a",

		[{op: "remove", path: "/providers/external_secrets/secretStore"}]

	)

    let error = ""
    try {
      await loadClaim(
        "SecretsClaim-secret_a",
        'firestartr-test',
        {
          ComponentClaim: {
            platformOwner: "group:my-team",
          },
        },
        patchClaim,
        loadInitializers,
        loadGlobals,
        loadOverrides,
        loadNormalizers,
		await context.getClaimsDir()
      )
    } catch(err) {
      error = err;
    }

    expect(error.includes(
		"must have required property 'secretStore'"
    )).toEqual(true)

  });

});

