import Doppleman from "./fixtures/k8s_doppleman";
import { GithubRepositoryOverrider } from "../src/overriders/githubRepositoryOverride";
import { ICustomResourcePatch } from "../src/patches";
import { setRenderedClaim } from "../src/refresolver";

let patches: ICustomResourcePatch[];

describe("The github repository overrider", () => {

  setRenderedClaim(
    { kind: "UserClaim", name: "user-a" },
    { kind: "FirestartrGithubMembership", metadata: { name: "user-a" } }
  )
  setRenderedClaim(
    { kind: "UserClaim", name: "user-h" },
    { kind: "FirestartrGithubMembership", metadata: { name: "user-h" } }
  )
  setRenderedClaim(
    { kind: "UserClaim", name: "user-f" },
    { kind: "FirestartrGithubMembership", metadata: { name: "user-f" } }
  )
  setRenderedClaim(
    { kind: "UserClaim", name: "user-d" },
    { kind: "FirestartrGithubMembership", metadata: { name: "user-d" } }
  )

  it("can correctly override values", async () => {
    patches = await new GithubRepositoryOverrider().patches({
      providers: {
        github: {
          overrides: {
            additionalAdmins: ["user:user-a"],
            additionalMaintainers: ["user:user-h"],
            additionalWriters: ["user:user-f"],
            additionalReaders: ["user:user-d"],
          }
        }
      }
    }, {});

    let doppleman: Doppleman = new Doppleman({ spec: { permissions: [] } }, patches)
    doppleman.set("provider", "github")

    expect(
      (await doppleman.render())
    ).toEqual({
      spec: {
        permissions: [{
          ref: {
            kind: "FirestartrGithubMembership",
            name: "user-a",
            needsSecret: false,
          },
          role: "admin",
        }, {
          ref: {
            kind: "FirestartrGithubMembership",
            name: "user-h",
            needsSecret: false,
          },
          role: "maintain",
        }, {
          ref: {
            kind: "FirestartrGithubMembership",
            name: "user-f",
            needsSecret: false,
          },
          role: "push",
        }, {
          ref: {
            kind: "FirestartrGithubMembership",
            name: "user-d",
            needsSecret: false,
          },
          role: "pull",
        }]
      }
    });
  });
})
