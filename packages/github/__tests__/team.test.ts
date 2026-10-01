import { getTeamMembers, getTeamInfo, getTeamRoleUser } from "../src/team";
import { Octokit } from '@octokit/rest';

const mockedMembers = [{login: 'mocked'}, {login: 'example'}];
const mocekdTeamData = { name: 'mocked', description: 'Mocked group', members: ['mockerd', 'example']}
const mockedMembership = { role: 'member'};
const mockGetByName = jest.fn(() => {
  return {data: mocekdTeamData};
});

jest.mock("../src/auth_installation", () =>{
    const getInstallationID = jest.fn(async function(org: string) { return '19234234' })

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
    rest: {
      teams: {
        listMembersInOrg: () => {
          return { data: mockedMembers }
        },
        getByName: mockGetByName,
        getMembershipForUserInOrg: () => {
          return { data: mockedMembership}
        }
      }
    },
  })),
}));

const mockedPluginFunction = jest.fn().mockReturnValue(Octokit);

beforeEach(() => {
  Octokit.plugin = mockedPluginFunction;
  mockGetByName.mockClear();
  mockGetByName.mockImplementation(() => {
    return {data: mocekdTeamData};
  });
});

describe('#github.team', () => {
  it('Should be able to list the members of a team', async () => {
    const teams = await getTeamMembers('mocked-team', 'example-org');
    expect(teams).toBe(mockedMembers);
  });

  it('Should be able to get the team data', async () => {
    const teamData = await getTeamInfo('mocked-team', 'example-org');
    expect(teamData).toBe(mocekdTeamData);
  });

  it('Should include org and team when team data lookup fails', async () => {
    mockGetByName.mockImplementationOnce(() => {
      throw Object.assign(new Error('Not Found'), {status: 404});
    });

    await expect(getTeamInfo('missing-team', 'example-org')).rejects.toMatchObject({
      message:
        'Error getting GitHub team "missing-team" in org "example-org": Not Found',
      status: 404,
    });
  });

  it('Should be able to get the role of a user on a team', async () => {
    const roleData = await getTeamRoleUser('mocked-team', 'example-org', 'mocked');
    expect(roleData).toBe(mockedMembership);
  });
});
