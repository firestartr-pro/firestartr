export default {
  rootDir: '.',
  verbose: true,
  projects: [
    {
      preset: 'ts-jest',
      testEnvironment: 'node',
      displayName: 'github',
      setupFilesAfterEnv: ['./setup.js'],
      testMatch: ['<rootDir>/__tests__/**/*test.ts'],
      moduleNameMapper: {
        '^github$': '<rootDir>/../github/index',
      },
      transform: {
        '^.+\\.js$': ['ts-jest'],
      },
      transformIgnorePatterns: ['../../node_modules/(?!@octokit/)'],
    },
  ],
};
