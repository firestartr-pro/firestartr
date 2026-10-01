export default {
  repo: {
    repoExists: jest.fn(),
    getBranchProtection: jest.fn(),
  },
  branches: {
    getBranch: jest.fn(),
    listBranches: jest.fn(),
  },
  encryption: {
    encryptRepoSecret: jest.fn(),
  },
};
