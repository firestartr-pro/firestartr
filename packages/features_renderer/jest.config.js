export default {
  rootDir: '.',
  verbose: true,
  projects: [
    {
      preset: 'ts-jest',
      testEnvironment: 'node',
      displayName: 'features_renderer',
      setupFilesAfterEnv: ['./setup.js'],
      testMatch: ['<rootDir>/__tests__/**/*test.ts'],
      moduleNameMapper: {
        '^catalog_common$': '<rootDir>/../catalog_common/index',
        '^cdk8s_renderer$': '<rootDir>/../cdk8s_renderer/index',
        '^features_renderer$': '<rootDir>/../features_renderer/index',
        '^github$': '<rootDir>/../github/index',
        '^terraform_provisioner$': '<rootDir>/../terraform_provisioner/index',
      },
    },
  ],
};
