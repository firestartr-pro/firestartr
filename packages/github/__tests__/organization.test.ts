const mockedOrgName = "example-org"

const mockedRepoList = [
  {
    name: "mocked-repo",
    description: "test-repo-description",
    owner: { login: "mocked" },
  },
  {
    name: "example-repo",
    description: "test-repo-description",
    owner: { login: "example" },
  },
];

const mockedTeams = [
  { name: "mocked-team", members: ["mocked", "example"] },
  { name: "nobody", members: [] },
];

const mockedMembers = [
  { login: "mocked", email: "mocked@example.com" },
  { login: "example", email: "example@example.com" },
];

const mockedMembership = { role: "member" };

const mockedOrgInfo = { data: { name: mockedOrgName, plan: { name: "test-plan" } } };

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
    paginate: (options: any) => {
      if (options.kind === "repos") {
        return mockedRepoList;
      } else if (options.kind === "teams") {
        return mockedTeams;
      } else {
        return mockedMembers;
      }
    },
    repos: {
      listForOrg: {
        endpoint: {
          merge: () => {
            return { kind: "repos" };
          },
        },
      },
    },
    rest: {
      orgs: {
        listMembers: {
          endpoint: {
            merge: () => {
              return { kind: "members" };
            },
          },
        },
      },
      teams: {
        list: {
          endpoint: {
            merge: () => {
              return { kind: "teams" };
            },
          },
        },
      },
    },
    orgs: {
      get: (_data: any) => {
        return mockedOrgInfo;
      },
      checkMembershipForUser: (data: any) => {
        if (data.username === "external" || data.org === "external") {
          throw "Not a member";
        }

        return mockedMembership;
      },
      getMembershipForUser: (data: any) => {
        var role = "member";
        if (data.org === "adminOrg") {
          role = "admin";
        }

        return { data: { role: role } };
      },
    },
  })),
}));


import {
  getRepositoryList,
  getTeamList,
  getUserList,
  validateMember,
  getUserRoleInOrg,
  getOrgInfo,
  getOrgPlanName,
} from "../src/organization";
import { Octokit } from '@octokit/rest';

const mockedPluginFunction = jest.fn().mockReturnValue(Octokit);

beforeEach(() => {
  Octokit.plugin = mockedPluginFunction;
});

describe("#github.org", () => {
  it("Should be able to get the list of repos from the organization", async () => {
    const repos = await getRepositoryList(mockedOrgName);
    expect(repos).toBe(mockedRepoList);
  });

  it("Should be able to get the list of teams from the organization", async () => {
    const teams = await getTeamList(mockedOrgName);
    expect(teams).toBe(mockedTeams);
  });

  it("Should be able to get the list of users from the organization", async () => {
    const users = await getUserList(mockedOrgName);
    expect(users).toBe(mockedMembers);
  });

  it("Should be able to get the data from a member of the organization", async () => {
    const membershipData = await validateMember("user", "org");
    expect(membershipData).toBe(mockedMembership);
  });

  it("Should be able to get the membership of a user in an organization", async () => {
    expect(await getUserRoleInOrg("user", "org")).toBe("member");
    expect(await getUserRoleInOrg("user", "adminOrg")).toBe("admin");
  });

  it("Should throw an error if user is not a member of the organization", async () => {
    expect.assertions(1);
    try {
      await validateMember("external", "external");
    } catch (e: any) {
      expect(e).toMatch("Not a member");
    }
  });

  it("Should be able to get the information of an organization", async () => {
    const result = await getOrgInfo(mockedOrgName);
    expect(result).toEqual(mockedOrgInfo.data);
  });

  it("Should be able to get the name of an organization's plan", async () => {
    const result = await getOrgPlanName(mockedOrgName);
    expect(result).toEqual(mockedOrgInfo.data.plan.name);
  });
});
