import { Octokit } from "@octokit/rest";
import { getOctokitForOrg } from "../src/auth";

jest.mock("../src/auth_installation", () =>{

    const getInstallationID = jest.fn(async function(org: string){

        return '19234234'

    })

    return {

        getInstallationID

    }


})

// Mock the environment module to return a dummy token for testing
jest.mock('catalog_common', () => ({
  types: {
    envVars: {
      token: "foo"
    },
  },
  environment: {
    getFromEnvironment: jest.fn().mockReturnValue('dummy_token'),
    getFromEnvironmentWithDefault: jest.fn().mockReturnValue('dummy_token'),
    checkExistOnEnvironment: jest.fn().mockReturnValue(true)
  },
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    silly: jest.fn(),
  },
}));

describe('#github.auth', () => {
  // Test the non-paginated octokit instance
  it('Should be able to create an Ocktokit instance', async() => {
    process.env.TOKEN = "LOL"

    const octokit = await getOctokitForOrg(
      "default",
      false,
      jest.fn().mockReturnValue('dummy_token')
    );
    expect(octokit).toBeInstanceOf(Octokit);
  });

  // Test the paginated octokit instance
  it('Should be able to create an Ocktokit instance with pagination plugin', async () => {

    const octokitPaginated =await getOctokitForOrg("default", true, jest.fn().mockReturnValue('dummy_token'));

    expect(octokitPaginated).toBeInstanceOf(Octokit);
  });
});
