export default {
  rootDir: '.',
  verbose: true,
  moduleDirectories: ['<rootDir>/node_modules'],
  projects: [
    {
      preset: 'ts-jest',
      testEnvironment: 'node',
      displayName: 'cli',
      setupFilesAfterEnv: ['./setup.js'],
      testMatch: ['<rootDir>/__tests__/*.ts'],
      moduleFileExtensions: ['ts', 'js', 'json', 'node'],
      moduleNameMapper: {
        '^catalog_common$': '<rootDir>/../catalog_common/index',
        '^cdk8s_renderer$': '<rootDir>/../cdk8s_renderer/index',
        '^features_renderer$': '<rootDir>/../features_renderer/index',
        '^github$': '<rootDir>/../github/index',
        '^gh_provisioner$': '<rootDir>/../gh_provisioner/index',
        '^terraform_provisioner$': '<rootDir>/../terraform_provisioner/index',
      },
      transform: {
        '^.+\\.js$': ['ts-jest'],
      },
      transformIgnorePatterns: ['../../node_modules/(?!@octokit/)'],
    },
  ],
};
