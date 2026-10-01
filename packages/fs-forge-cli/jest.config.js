export default {
  rootDir: '.',
  verbose: true,
  projects: [
    {
      preset: 'ts-jest',
      testEnvironment: 'node',
      displayName: 'fs-forge-cli',
      testMatch: ['<rootDir>/__tests__/**/*test.ts'],
      moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
      },
      transform: {
        '^.+\\.js$': ['ts-jest'],
      },
      transformIgnorePatterns: [
        '/node_modules/(?!(?:@octokit|before-after-hook|universal-user-agent)/)',
      ],
    },
  ],
};
