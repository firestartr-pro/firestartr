export default {
  rootDir: '.',
  verbose: true,
  projects: [
    {
      preset: 'ts-jest',
      testEnvironment: 'node',
      displayName: 'cli',
      setupFilesAfterEnv: ['./setup.js'],
      testMatch: ['<rootDir>/__tests__/**/*test.ts'],
      moduleNameMapper: {
        '^catalog_common$': '<rootDir>/../catalog_common/index',
        '^cdk8s_renderer$': '<rootDir>/../cdk8s_renderer/index',
        '^features_renderer$': '<rootDir>/../features_renderer/index',
        '^github$': '<rootDir>/../github/index',
        '^terraform_provisioner$': '<rootDir>/../terraform_provisioner/index',
        '^importer$': '<rootDir>/../importer/index',
        '^scaffolder$': '<rootDir>/../scaffolder/index',
        '^operator$': '<rootDir>/../operator/index',
        '^crs_analyzer$': '<rootDir>/../crs_analyzer/index',
        '^crs_status_service$': '<rootDir>/../crs_status_service/index',
      },
      modulePathIgnorePatterns: [
        '<rootDir>/../*/dist/',
        '<rootDir>/../*/build/',
      ],
      transform: {
        '^.+\\.js$': ['ts-jest'],
      },
      transformIgnorePatterns: ['../../node_modules/(?!@octokit/)'],
    },
  ],
};
