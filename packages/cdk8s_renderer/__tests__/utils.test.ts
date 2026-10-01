import { mergeTwoArrays } from "../src/utils/crUtils";
import { resolveStringReference } from "../src/utils/claimUtils";
import {
  createPermissionFor, createPermissionsListFor,
  createCRrefFrom, createCodeOwnersData, resolveCodeownersRef
} from "../src/utils/repositoryClaimUtils";
import { setRenderedClaim, emptyRenderedClaims } from "../src/refresolver"

import * as jsonPatch from "fast-json-patch";
import * as path from "path";
import * as fs from "fs";
import common from "catalog_common";

import {createTestContext} from "./auxiliar";

describe("The CR utils package:", () => {

  let firstUserData: any = null
  let secondUserData: any = null

  const thirdUserData: any = {
    "kind": "UserClaim",
    "name": "user-c",
    "org": "firestartr-test",
    "role": "admin",
  };
  const updatedFirstUserData: any = {
    "kind": "UserClaim",
    "name": "user-a",
    "org": "cambio-org-test",
    "role": "cambio-role",
  };

  let context = null

  beforeAll(async () => {

    context = await createTestContext({})

    // we prepare two users
    await context.applyPatches(

        "user_a",

        [
            {op: "replace", path: "/name", value: "user-a"},
            {op: "replace", path: "/profile/displayName", value: "user-a"},
            {op: "replace", path: "/providers/github/name", value: "user-a-github"},
        ]

    )

    firstUserData = common.io.fromYaml(await context.getFile("user_a"));

    await context.applyPatches(

        "user_a",

        [
            {op: "replace", path: "/name", value: "user-e"},
            {op: "replace", path: "/profile/displayName", value: "user-e"},
            {op: "replace", path: "/providers/github/name", value: "user-e"},
        ]

    )

    secondUserData = common.io.fromYaml(await context.getFile("user_a"));

  })

  it("merges two arrays preserving their order", async () => {
    const originalArray: any[] = [ firstUserData, secondUserData ];
    const arrayToCompare: any[] = [ thirdUserData, updatedFirstUserData ];
    const result: any[] = mergeTwoArrays(
      originalArray, arrayToCompare, ["kind", "name"], (a: any, b: any) => {
        return jsonPatch.compare(a, b).filter((op) => op.op !== "remove");
      }
    );

    // Check order
    expect(result[0].name).toEqual("user-a");
    expect(result[1].name).toEqual("user-e");
    expect(result[2].name).toEqual("user-c");

    // Check values
    expect(result[0].org).toEqual(updatedFirstUserData.org);
    expect(result[0].role).toEqual(updatedFirstUserData.role);
    expect(result[0].displayName).toEqual(firstUserData.displayName);
    expect(result[1]).toEqual(secondUserData);
    expect(result[2]).toEqual(thirdUserData);
  });

  it("correctly manages duplicated elements on one/both of the arrays", async () => {
    const originalArray: any[] = [ firstUserData, firstUserData ];
    const arrayToCompare: any[] = [ firstUserData, firstUserData, thirdUserData ];
    const result: any[] = mergeTwoArrays(
      originalArray, arrayToCompare, ["kind", "name"], (a: any, b: any) => {
        return jsonPatch.compare(a, b).filter((op) => op.op !== "remove");
      }
    );
    expect(result.length).toEqual(2);
    expect(result[0].name).toEqual(firstUserData.name);
    expect(result[1].name).toEqual(thirdUserData.name);
  });

});

describe("The claim utils package:", () => {

  it("can resolve claim string references", () => {

    const groupReference: string = "group:a";
    expect(resolveStringReference(groupReference)).toEqual({
      kind: "FirestartrGithubGroup", name: "a"
    })

    const userReference: string = "user:b";
    expect(resolveStringReference(userReference)).toEqual({
      kind: "FirestartrGithubMembership", name: "b"
    })

    const repoReference: string = "repo:c";
    expect(resolveStringReference(repoReference)).toEqual({
      kind: "FirestartrGithubRepository", name: "c"
    })

    const featReference: string = "feat:d";
    expect(resolveStringReference(featReference)).toEqual({
      kind: "FirestartrGithubRepositoryFeature", name: "d"
    })

  });

});

describe("The repository claim utils package:", () => {

  let context = null

  beforeAll(async () => {

    context = await createTestContext({})

    setRenderedClaim({
      kind: "GroupClaim",
      name: "group-a",
    }, {
      kind: "FirestartrGithubGroup",
      metadata: {
        name: "group-a",
      }
    })

    setRenderedClaim({
      kind: "UserClaim",
      name: "b",
    }, {
      kind: "FirestartrGithubMembership",
      metadata: {
        name: "b",
      }
    });

  });

  it("can create a permission for a string reference", () => {

    const groupStrRef: `group:${string}` = "group:group-a";
    const groupObjRef: any = {
      kind: "FirestartrGithubGroup",
      name: "group-a",
      needsSecret: true,
    }

    expect(createPermissionFor(groupStrRef, "admin")).toEqual({
      role: "admin", ref: groupObjRef,
    })
    expect(createPermissionFor(groupStrRef, "push")).toEqual({
      role: "push", ref: groupObjRef,
    })
    expect(createPermissionFor(groupStrRef, "pull")).toEqual({
      role: "pull", ref: groupObjRef,
    })
    expect(createPermissionFor(groupStrRef, "maintain")).toEqual({
      role: "maintain", ref: groupObjRef,
    })


    const userStrRef: `user:${string}` = "user:b";
    const userObjRef: any = {
      kind: "FirestartrGithubMembership",
      name: "b",
      needsSecret: false,
    }

    expect(createPermissionFor(userStrRef, "admin")).toEqual({
      role: "admin", ref: userObjRef,
    })
    expect(createPermissionFor(userStrRef, "push")).toEqual({
      role: "push", ref: userObjRef,
    })
    expect(createPermissionFor(userStrRef, "pull")).toEqual({
      role: "pull", ref: userObjRef,
    })
    expect(createPermissionFor(userStrRef, "maintain")).toEqual({
      role: "maintain", ref: userObjRef,
    })

  });

  it("can create permissions for a string reference list", () => {

    const strRefList: (`group:${string}` | `user:${string}`)[] = [
      "group:group-a", "user:b"
    ];
    const groupObjRef: any = {
      kind: "FirestartrGithubGroup",
      name: "group-a",
      needsSecret: true,
    }
    const userObjRef: any = {
      kind: "FirestartrGithubMembership",
      name: "b",
      needsSecret: false,
    }

    expect(createPermissionsListFor(strRefList, "admin")).toEqual([
      { role: "admin", ref: groupObjRef },
      { role: "admin", ref: userObjRef }
    ])
    expect(createPermissionsListFor(strRefList, "push")).toEqual([
      { role: "push", ref: groupObjRef },
      { role: "push", ref: userObjRef }
    ])
    expect(createPermissionsListFor(strRefList, "pull")).toEqual([
      { role: "pull", ref: groupObjRef },
      { role: "pull", ref: userObjRef }
    ])
    expect(createPermissionsListFor(strRefList, "maintain")).toEqual([
      { role: "maintain", ref: groupObjRef },
      { role: "maintain", ref: userObjRef }
    ])

  });

  it("can create a reference object from a string reference", () => {

    const groupStrRef: `group:${string}` = "group:a";
    const groupObjRef: any = {
      ref: {
        kind: "FirestartrGithubGroup",
        name: "a",
        needsSecret: true,
      }
    }
    expect(createCRrefFrom(groupStrRef, true)).toEqual(groupObjRef)

    const userStrRef: `user:${string}` = "user:b";
    const userObjRef: any = {
      ref: {
        kind: "FirestartrGithubMembership",
        name: "b",
        needsSecret: false,
      }
    };
    expect(createCRrefFrom(userStrRef, false)).toEqual(userObjRef);

  });

  it("can create codeowners data for a claim", async () => {

    const claim: any = common.io.fromYaml(await context.getFile("component_a"));

    setRenderedClaim({
      kind: "GroupClaim",
      name: "group_a",
    }, {
      kind: "FirestartrGithubGroup",
      metadata: {
        name: "firestartr-test/group-a",
        annotations: {
          "firestartr.dev/external-name": "group-a",
          "firestartr.dev/claim-ref": "GroupClaim/group_a"
        }
      }
    })

    setRenderedClaim({
      kind: "GroupClaim",
      name: "group_b",
    }, {
      kind: "FirestartrGithubGroup",
      metadata: {
        name: "firestartr-test/group-b",
        annotations: {
          "firestartr.dev/external-name": "group-b",
          "firestartr.dev/claim-ref": "GroupClaim/group_b"
        }
      }
    })

    setRenderedClaim({
      kind: "UserClaim",
      name: "user_a",
    }, {
      kind: "FirestartrGithubMembership",
      metadata: {
        name: "firestartr-test/user-a",
        annotations: {
          "firestartr.dev/external-name": "user_a",
          "firestartr.dev/claim-ref": "UserClaim/user_a"
        }
      }
    })

    setRenderedClaim({
      kind: "UserClaim",
      name: "user-a",
    }, {
      kind: "FirestartrGithubMembership",
      metadata: {
        name: "firestartr-test/user-a",
        annotations: {
          "firestartr.dev/external-name": "user-a",
          "firestartr.dev/claim-ref": "UserClaim/user-a"
        }
      }
    })


    // Without additional rules
    expect(createCodeOwnersData(claim)).toEqual(
      "# This file was generated by firestartr.\n" +
      "# WARNING: Please don't edit this file directly in the repository\n" +
      "# Go to gitops repository to modify it!\n" +
      "*                         @firestartr-test/group_a\n" +
      "/.github/                 @firestartr-test/group_b"
    )

    expect(createCodeOwnersData(
      claim, claim.providers.github.overrides.additionalCodeownersRules
    )).toEqual(
      "# This file was generated by firestartr.\n" +
      "# WARNING: Please don't edit this file directly in the repository\n" +
      "# Go to gitops repository to modify it!\n" +
      "*                         @firestartr-test/group_a\n" +
      "/.github/                 @firestartr-test/group_b\n" +
      "*.js                      @user_a\n" +
      "*.c                       @user_a\n" +
      "*.py                      @user_a"
    )

    expect(createCodeOwnersData(claim, [
      {
        path: "*",
        owners: [
          "user:user_a",
          "group:group_a",
        ]
      },
      {
        path: "/.github/",
        owners: [
          "group:group_a"
        ]
      },
      {
        path: "custom/**",
        owners: [
          "group:group_b",
          "user:user-a",
        ]
      },
      {
        path: "custom/**",
        owners: [
          "user:user_a"
        ]
      }
    ])).toEqual(
      "# This file was generated by firestartr.\n" +
      "# WARNING: Please don't edit this file directly in the repository\n" +
      "# Go to gitops repository to modify it!\n" +
      "*                         @firestartr-test/group_a @user_a\n" +
      "/.github/                 @firestartr-test/group_b @firestartr-test/group_a\n" +
      "custom/**                 @firestartr-test/group_b @user-a @user_a"
    )

  });

  describe("resolveCodeownersRef via the crs map fallback path", () => {

    const org = "firestartr-test";

    afterEach(() => {
      emptyRenderedClaims();
    });

    it("resolves a group handle from the slug in the claim-ref annotation (not external-name)", () => {
      // Simulates the importer after setPreviousCRs: CRs are keyed by a
      // UUID-suffixed metadata.name and only resolvable through the
      // firestartr.dev/claim-ref annotation.
      const crs: any = {
        "FirestartrGithubGroup-platform-team-3914ca50-cc80-4961-a139-464028818a92": {
          kind: "FirestartrGithubGroup",
          metadata: {
            name: "platform-team-3914ca50-cc80-4961-a139-464028818a92",
            annotations: {
              "firestartr.dev/claim-ref": "GroupClaim/platform_team",
              "firestartr.dev/external-name": "Platform Team",
            },
          },
        },
      };

      expect(resolveCodeownersRef("group:platform_team", org, crs)).toEqual(
        `@${org}/platform_team`
      );

      // ensure the display name in external-name was NOT used as the handle
      expect(
        resolveCodeownersRef("group:platform_team", org, crs)
      ).not.toContain("Platform");
    });

    it("resolves a user handle from the slug in the claim-ref annotation", () => {
      const crs: any = {
        "FirestartrGithubMembership-alice-github": {
          kind: "FirestartrGithubMembership",
          metadata: {
            name: "alice-github",
            annotations: {
              "firestartr.dev/claim-ref": "UserClaim/alice",
              "firestartr.dev/external-name": "Alice",
            },
          },
        },
      };

      expect(resolveCodeownersRef("user:alice", org, crs)).toEqual(
        `@alice`
      );
    });

    it("prefers the firestartr.dev/github-slug annotation when present", () => {
      // When the operator has backfilled the slug, it is the authoritative
      // value and takes precedence over the claim-ref slug. Today it is never
      // populated, so this documents future-proofing behaviour.
      const crs: any = {
        "FirestartrGithubGroup-platform-team-abc123": {
          kind: "FirestartrGithubGroup",
          metadata: {
            name: "platform-team-abc123",
            annotations: {
              "firestartr.dev/claim-ref": "GroupClaim/platform_team",
              "firestartr.dev/external-name": "Platform Team",
              "firestartr.dev/github-slug": "platform",
            },
          },
        },
      };

      expect(resolveCodeownersRef("group:platform_team", org, crs)).toEqual(
        `@${org}/platform`
      );
    });

    it("throws when the crs map has no matching claim-ref annotation", () => {
      const crs: any = {
        "FirestartrGithubGroup-other-abc123": {
          kind: "FirestartrGithubGroup",
          metadata: {
            name: "other-abc123",
            annotations: {
              "firestartr.dev/claim-ref": "GroupClaim/other",
              "firestartr.dev/external-name": "Other",
            },
          },
        },
      };

      expect(() => resolveCodeownersRef("group:platform_team", org, crs)).toThrow(
        /Claim GroupClaim-platform_team not found/
      );
    });

  });

});
