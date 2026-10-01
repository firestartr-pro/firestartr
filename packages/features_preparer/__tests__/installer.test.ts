import common from "catalog_common";
import * as path from "path";
import * as fs from "fs";
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'stream/web';
import { downloadFeatureZip } from '../src/installer';
import preparer from "../src";

let githubMockInvoked = false

jest.mock("github", () => {
  const originalModule = jest.requireActual("github");
  return {
    ...originalModule.default,
    getOctokitForOrg(owner) {
      return {
        request(url, opts) {

          githubMockInvoked = true

          return {
            data: fs.readFileSync(
              path.join(__dirname, "fixtures/feature_tarballs/feature_a.tar.gz")
            ),
            url: `mocked`
          }
        }
      }
    },
    getOctokitFromPat(envVar) {
      return {
        request(url, opts) {

         githubMockInvoked = true
          return {
            data: fs.readFileSync(
              path.join(__dirname, "fixtures/feature_tarballs/feature_a.tar.gz")
            )
          }
        }
      }
    },
    repo: {
      ...originalModule.default.repo,
      getContent() {
        githubMockInvoked = true
        return '{"packages/tech_docs":"0.5.0","packages/issue_templates":"1.0.2","packages/build_images":"1.0.1"}';
      },
      getReleaseByTag(tag, repo, owner) {
        githubMockInvoked = true
        return { tag_name: tag }
      },
    },
  };
});

jest.mock("../src/zip", () => {

    const fnDownloadZipBallMock = jest.fn(async (url: string, filePath: string) => {

        const data = fs.readFileSync(path.join(__dirname, "fixtures/feature_zipballs/feature_a.zip"))

        fs.writeFileSync(filePath, data);
    })

    return {

        downloadZipBall: fnDownloadZipBallMock

    }

})

describe("Render files in multiple directories", () => {

  beforeEach(() => {
  
      githubMockInvoked = false
  
  })

  // We should test this with a mockup of the github api
  it("should be able to install a feature", async function () {

    // get mock component file
    const componentFile = common.io.fromYaml(fs.readFileSync(path.join(
      __dirname,
      "fixtures/mock_catalog/components/repository_a.yaml"
    ), 'utf-8'));

    /*
    * Should not throw an error
    */
    await preparer.getFeatureConfig("release_please", "1.1.0", componentFile);
  });

  it("should be able to reuse already downloaded features, when found", async function () {
    // get mock component file
    const componentFile = common.io.fromYaml(fs.readFileSync(path.join(
      __dirname,
      "fixtures/mock_catalog/components/repository_a.yaml"
    ), 'utf-8'));

    /*
    * Should not throw an error
    */
    await preparer.getFeatureConfig("release_please", "1.1.0", componentFile);

    expect(githubMockInvoked).toBe(false);
  });

  it('should not fail with ENOTEMPTY when the same feature is downloaded concurrently', async function () {
    const featureName = 'feature_a';
    const reference = 'concurrency-test-v1';
    const owner = 'prefapp';
    const repo = 'features';
    const extractPath = common.features.tarballs.getFeaturesExtractPath(
      featureName,
      reference,
      owner,
      repo,
      { createIfNotExists: false },
    );

    fs.rmSync(extractPath, { recursive: true, force: true });

    try {
      const [first, second] = await Promise.all([
        downloadFeatureZip(repo, featureName, reference, owner),
        downloadFeatureZip(repo, featureName, reference, owner),
      ]);

      expect(first).toBe(extractPath);
      expect(second).toBe(extractPath);
      expect(fs.existsSync(extractPath)).toBe(true);
    } finally {
      fs.rmSync(extractPath, { recursive: true, force: true });
    }
  });
});
