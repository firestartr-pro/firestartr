import { resolveFeatureCommit } from "../src/installer";

const runIntegration =
  process.env["INTEGRATION_TESTS_ACTIVE"] === "true" ||
  (Boolean(process.env["GITHUB_APP_ID"]) &&
    Boolean(process.env["GITHUB_APP_PEM_FILE"]));

const describeIntegration = runIntegration ? describe : describe.skip;

const owner = process.env["INTEGRATION_OWNER"] ?? "prefapp";
const repo = process.env["INTEGRATION_REPO"] ?? "features";
const reference = process.env["INTEGRATION_REF"] ?? "main";

describeIntegration(
  "resolveFeatureCommit integration (real GitHub API)",
  () => {
    it(`resolves a real commit sha and matching tags for ${owner}/${repo}@${reference}`, async () => {
      const result = await resolveFeatureCommit(owner, repo, reference);

      // A valid full git SHA is 40 lowercase hexadecimal characters.
      expect(result.sha).toMatch(/^[0-9a-f]{40}$/);
      expect(Array.isArray(result.tags)).toBe(true);
    }, 30000);
  },
);
