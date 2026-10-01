import { getUserInfo } from "../src/user";
import { Octokit } from '@octokit/rest';

const mockedUser = {
  login: 'mocked',
  email: 'mocked@example.com',
  avatar_url: 'https://example.com/mocked.png',
};

jest.mock("../src/auth_installation", () =>{
    const getInstallationID = jest.fn(async function(org: string){ return '19234234' })

    return { getInstallationID }
})

jest.mock("@octokit/auth-app", () => {
  return {
    createAppAuth: function(){
      return async function(){
        return {
          token: "mocked-token"
        }
      }
    }
  }
})

jest.mock("@octokit/rest", () => ({
  Octokit: jest.fn().mockImplementation(() => ({
    users: {
      getByUsername: () => { return mockedUser },
    },
    plugin: function () { return this; }
  })),
}));

const mockedPluginFunction = jest.fn().mockReturnValue(Octokit);

beforeEach(() => {
  Octokit.plugin = mockedPluginFunction;
});

describe('#github.user', () => {
  it('Should be able to get the user data', async () => {
    const userData = await getUserInfo('mocked');
    expect(userData).toEqual(mockedUser);
  });
});
