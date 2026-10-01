export default {
  rootDir: '.',
  verbose: true,
  testTimeout: 360000, // 6 minutes
  globalSetup: '<rootDir>/globalSetup.ts',
  globalTeardown: '<rootDir>/globalTeardown.ts',
  projects: [
    {
      preset: 'ts-jest',
      testEnvironment: 'node',
      displayName: 'e2e',
      testMatch: ['<rootDir>/__tests__/**/*.test.ts'],
      moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json'],
      moduleNameMapper: {
        '^catalog_common$': '<rootDir>/../catalog_common/index.ts',
        '^features_preparer$': '<rootDir>/../features_preparer/index.ts',
        '^features_renderer$': '<rootDir>/../features_renderer/index.ts',
        '^github$': '<rootDir>/../github/index.ts',
        '^importer$': '<rootDir>/../importer/index.ts',
        '^render$': '<rootDir>/../cdk8s_renderer/index.ts',
      },
      transform: {
        '^.+\\.js$': ['ts-jest'],
      },
      transformIgnorePatterns: ['../../node_modules/(?!@octokit/)'],
    },
  ],
};
