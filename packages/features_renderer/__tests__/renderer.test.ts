import * as path from "path";
import * as fs from "fs";
import renderFeature from "../src/render";
import { execSync } from "child_process";
import common from "catalog_common";

describe("Render files in multiple directories", () => {
  const directory = "/tmp/feature_a-v1.0.0-extract";
  beforeAll(() => {
    // If directory exists, clear it for tests
    if (fs.existsSync(directory)) {
      execSync(`rm -rf ${directory}`);
    }

    // Create directory
    fs.mkdirSync(directory);
  });

  afterAll(() => {
    // Remove the temporary directory (if exists)
    if (fs.existsSync(directory)) {
      execSync(`rm -rf ${directory}`);
    }
  });

  it("should throw an error with a non existent technology", async function () {
    renderFeature(
      path.join(__dirname, "fixtures/features/feature_a"),

      "/tmp/feature_a-v1.0.0.-extract",

      {
        name: "test",
        annotations: {
          "firestartr.dev/dest-annotation": "test.txt",
        },
        providers: {
          github: {
            org: "prefapp",
            technology: { stack: "python" },
          },
        },
      }
    );
  });


  it("add trazability whenever is due", async function () {
    renderFeature(
      path.join(__dirname, "fixtures/features/workflows"),

      "/tmp/workflows-v1.0.0.-extract",

      {},

      {},

      {

          traceability: {
          
              owner: "prefapp",

              repo: "features",

              name: "workflows",

              version: "2.1.0",

              ref: "workflows-v2.1.0",

              url: "https://github.com/prefapp/features/tree/workflows-v2.1.0/packages/workflows"
          
          }
      }
    );

    const workflow = fs.readFileSync(
    
        "/tmp/workflows-v1.0.0.-extract/.github/workflows/pr-verify.yaml",

        'utf-8'
    )

    const firstLines = workflow.split("\n").slice(0, 4)

    expect(firstLines[0]).toEqual("---")
    expect(firstLines[1]).toEqual("# FEATURE_NAME: workflows")
    expect(firstLines[2]).toEqual("# FEATURE_VERSION: 2.1.0")
    expect(firstLines[3]).toEqual("# FEATURE_URL: https://github.com/prefapp/features/tree/workflows-v2.1.0/packages/workflows")

  });

      it("add git sha and tags to traceability stamp", async function () {
        renderFeature(
          path.join(__dirname, "fixtures/features/workflows"),
          "/tmp/workflows-git-sha-extract",
          {},
          {},
          {
            traceability: {
              owner: "prefapp",
              repo: "features",
              name: "workflows",
              version: "2.1.0",
              ref: "workflows-v2.1.0",
              url: "https://github.com/prefapp/features/tree/workflows-v2.1.0/packages/workflows",
              sha: "8804d4b99267c985383bd68026a89c0dc8d0bfe8",
              tags: ["claims_repo-v2.9.0", "claims_repo-v2"]
            }
          }
        );
        const workflow = fs.readFileSync(
          "/tmp/workflows-git-sha-extract/.github/workflows/pr-verify.yaml",
          'utf-8'
        );
        const firstLines = workflow.split("\n").slice(0, 6);
        expect(firstLines[0]).toEqual("---");
        expect(firstLines[1]).toEqual("# FEATURE_NAME: workflows");
        expect(firstLines[2]).toEqual("# FEATURE_VERSION: 2.1.0");
        expect(firstLines[3]).toEqual("# FEATURE_URL: https://github.com/prefapp/features/tree/workflows-v2.1.0/packages/workflows");
        expect(firstLines[4]).toEqual('# FEATURE_GIT_SHA: "8804d4b99267c985383bd68026a89c0dc8d0bfe8"');
        expect(firstLines[5]).toEqual("# FEATURE_GIT_TAGS: [\"claims_repo-v2.9.0\",\"claims_repo-v2\"]");
      });

      it("omit FEATURE_GIT_TAGS when no tags exist", async function () {
        renderFeature(
          path.join(__dirname, "fixtures/features/workflows"),
          "/tmp/workflows-no-tags-extract",
          {},
          {},
          {
            traceability: {
              owner: "prefapp",
              repo: "features",
              name: "workflows",
              version: "2.1.0",
              ref: "workflows-v2.1.0",
              url: "https://github.com/prefapp/features/tree/workflows-v2.1.0/packages/workflows",
              sha: "8804d4b99267c985383bd68026a89c0dc8d0bfe8",
              tags: []
            }
          }
        );
        const workflow = fs.readFileSync(
          "/tmp/workflows-no-tags-extract/.github/workflows/pr-verify.yaml",
          'utf-8'
        );
        const firstLines = workflow.split("\n").slice(0, 5);
        expect(firstLines[0]).toEqual("---");
        expect(firstLines[1]).toEqual("# FEATURE_NAME: workflows");
        expect(firstLines[2]).toEqual("# FEATURE_VERSION: 2.1.0");
        expect(firstLines[3]).toEqual("# FEATURE_URL: https://github.com/prefapp/features/tree/workflows-v2.1.0/packages/workflows");
        expect(workflow).toContain('# FEATURE_GIT_SHA: "8804d4b99267c985383bd68026a89c0dc8d0bfe8"');
        expect(workflow).not.toContain('FEATURE_GIT_TAGS');
      });


  it("should render different targetBranch", async function () {
    renderFeature(
      path.join(__dirname, "fixtures/features/feature_a"),

      "/tmp/feature_a-v1.0.0.-extract",

      {
        name: "test",
        annotations: {
          "firestartr.dev/dest-annotation": "test.txt",
        },
        providers: {
          github: {
            org: "prefapp",
            technology: { stack: "python" },
          },
        },
      }
    );

    const config = JSON.parse(fs.readFileSync(
    
        "/tmp/feature_a-v1.0.0.-extract/output.json",

        'utf-8'
    ))

    expect(config.files[0].targetBranch).toEqual("deployment")
    expect(config.files[1].targetBranch).toEqual("")
  });
});

describe("Render a claim-patches-only feature (no files)", () => {
  const renderPath = "/tmp/feature_claimpatches_only-render";

  beforeAll(() => {
    // If directory exists, clear it for tests
    if (fs.existsSync(renderPath)) {
      execSync(`rm -rf ${renderPath}`);
    }
  });

  afterAll(() => {
    // Remove the temporary directory (if exists)
    if (fs.existsSync(renderPath)) {
      execSync(`rm -rf ${renderPath}`);
    }
  });

  it("should render claimPatches without a files section and persist outputs", function () {
    const entity = common.io.fromYaml(
      fs.readFileSync(
        path.join(
          __dirname,
          "fixtures/mock_catalog/components/component_a.yaml"
        ),
        "utf8"
      )
    );

    const output = renderFeature(
      path.join(__dirname, "fixtures/features/feature_claimpatches_only"),

      renderPath,

      entity
    );

    expect(output.files).toEqual([]);
    expect(output.claimPatches).toEqual([
      {
        name: "add_annotation",
        op: "add",
        path: "/annotations/backstage.io~1techdocs-ref",
        value: "url:https://github.com/prefapp/feature_claimpatches_only/tree/main",
      },
    ]);
    expect(fs.existsSync(path.join(renderPath, "config.json"))).toBe(true);
    expect(fs.existsSync(path.join(renderPath, "output.json"))).toBe(true);
  });
});
