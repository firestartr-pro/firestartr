export default {
  rootDir: '.',
  verbose: true,
  projects: [
    {
      preset: 'ts-jest',
      testEnvironment: 'node',
      displayName: 'features_preparer',
      setupFilesAfterEnv: ['./setup.js'],
      testMatch: ['<rootDir>/__tests__/**/*test.ts'],
      moduleNameMapper: {
        '^catalog_common$': '<rootDir>/../catalog_common/index',
        '^features_renderer$': '<rootDir>/../features_renderer/index',
        '^github$': '<rootDir>/../github/index',
      },
      transform: {
        '^.+\\.js$': ['ts-jest'],
      },
      transformIgnorePatterns: ['../../node_modules/(?!@octokit/)'],
    },
  ],
};
