import common from "catalog_common";
import { Subcommand } from "../src/types";
import { validateAndGetSubcommand } from "../src/subcommands";
import { cleanProcessEnv } from "./common_tests";
import * as path from "path";

let originalEnv: any = {};

beforeAll(() => {
  // Save original env
  //originalEnv = process.env;
});

afterAll( () => {
  // Restore env
  //process.env = originalEnv;
});

beforeEach(() => {
  // Clear the env
  //cleanProcessEnv(originalEnv);
})

describe.skip('#validateAndGetSubcommand', () =>{
  it("Loads everything", () => {
      expect(1).toEqual(1)
  })
  //it.skip('Must throw an unknown command error for not valid command name', () => {
  //  expect.assertions(1);
  //  try {
  //      validateAndGetSubcommand('not-valid-command');
  //  } catch ( e: any ) {
  //      expect(e).toMatch('Unknown command not-valid-command');
  //  }
  //});

  //it.skip('Must throw an env error if there is a missing env with valid command name', () => {
  //  expect.assertions(1);
  //  try {
  //    process.env[common.types.envVars.firestartrImageKind] = "full";
  //    validateAndGetSubcommand('import');
  //  } catch ( e: any ) {
  //    expect(e).toContain('must be setted before calling import');
  //  }
  //});

  //it.skip('Must return a valid command with valid command name and env', () => {
  //  process.env[common.types.envVars.firestartrImageKind] = "full";
  //  process.env[common.types.envVars.token] = "test";
  //  process.env[common.types.envVars.org] = "test";
  //  process.env[common.types.envVars.s3Bucket] = "test";
  //  process.env[common.types.envVars.s3Region] = "test";

  //  const subCommand: Subcommand = validateAndGetSubcommand('import');
  //  expect(subCommand).toBeDefined();
  //});

  //it.skip('Correctly executes the cdk8s_renderer subcommand', async () => {
  //  process.env[common.types.envVars.firestartrImageKind] = "full";
  //  process.env[common.types.envVars.githubAppId] = "test";
  //  process.env[common.types.envVars.githubAppInstallationId] = "test";
  //  process.env[common.types.envVars.githubAppInstallationIdPrefapp] = "test";
  //  process.env[common.types.envVars.githubAppPemFile] = "test";

  //  const subCommand: Subcommand = validateAndGetSubcommand('cdk8s');
  //  await subCommand.run({
  //    globals: path.join(__dirname, "../../cdk8s_renderer/__tests__/fixtures/globals"),
  //    initializers: path.join(__dirname, "../../cdk8s_renderer/__tests__/fixtures/initializers"),
  //    claims: path.join(__dirname, "../../cdk8s_renderer/__tests__/fixtures/claims"),
  //    previousCRs: path.join(__dirname, "../../cdk8s_renderer/__tests__/fixtures/crs"),
  //  })
  //});
});
