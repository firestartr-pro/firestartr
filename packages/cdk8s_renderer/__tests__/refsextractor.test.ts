import { extractAllRefs } from "../src/refsSorter/refsExtractor";
import { RenderClaimKey } from '../src/renderer/types';
import * as path from "path";
import * as fs from "fs";
import YAML from "yaml";

import {createTestContext} from "./auxiliar";

const results = {

  "TFWorkspaceClaim-test": [
    "GroupClaim-firestartr-test-all",
    "SecretsClaim-secret_a",
    "SystemClaim-system_a",
    "TFWorkspaceClaim-workspace_b",

  ],
  "SecretsClaim-test": [ "SystemClaim-system_a", "GroupClaim-group_a"],
  "GroupClaim-test": [ "UserClaim-user_a", "GroupClaim-group_a" ],
  "ComponentClaim-test": [
      "GroupClaim-group_a",
      "UserClaim-user_a",
      "SystemClaim-system_a",
      "GroupClaim-group_b",
  ],
  "SystemClaim-test": ["DomainClaim-domain_a"],

}

function __test_reference_extractor(claimData: any, dataKey: string) {
  const refs = extractAllRefs(claimData);
  refs.sort()

  expect(results[dataKey].length).toEqual(refs.length)

  expect(refs.filter((ref) => results[dataKey].includes(ref)).length).toEqual(refs.length);
}

describe("The reference extractor", () => {

  let context = null

  beforeAll(async () => {
  
      context = await createTestContext({})

  })

  beforeEach(async () => {
    // Restart the test context before each test to ensure test isolation.
    await context.restart();
  });

  it("can extract all the references of a TfWorkspaceClaim", async () => {
    __test_reference_extractor(
      await context.getFile("workspace_a"),
      "TFWorkspaceClaim-test",
    );
  });

  it("can extract all the references of a TfWorkspaceClaim referencing a secret", async () => {

    await context.applyPatches(
        "workspace_a",
        [
            {
                path: "/providers/terraform/values/secret_test",
                op: "replace",
                value:  "ref:secretsclaim:secret_a:rds_conn"
            }
        ]

    )
    __test_reference_extractor(
      await context.getFile("workspace_a"),
      "TFWorkspaceClaim-test",
    );
  });

  it("can extract all the references of a SecretsClaim", async () => {
    __test_reference_extractor(
      await context.getFile("secret_a"),
      "SecretsClaim-test",
    );
  });

  it("can extract all the references of a GroupClaim", async () => {
    __test_reference_extractor(
      await context.getFile("group_b"),
      "GroupClaim-test",
    );
  });

  it("can extract all the references of a ComponentClaim", async () => {
    __test_reference_extractor(
      await context.getFile("component_a"),
      "ComponentClaim-test",
    );
  });

  it("can extract all the references of a SystemClaim", async () => {
    __test_reference_extractor(
      await context.getFile("system_a"),
      "SystemClaim-test",
    );
  });
});
