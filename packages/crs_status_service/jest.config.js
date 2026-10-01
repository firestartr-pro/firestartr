export default {
  rootDir: '.',
  verbose: true,
  moduleDirectories: ['<rootDir>/node_modules'],
  projects: [
    {
      preset: 'ts-jest',
      testEnvironment: 'node',
      displayName: 'crs_status_service',
      setupFilesAfterEnv: ['./setup.js'],
      testMatch: ['<rootDir>/__tests__/*.test.ts'],
      moduleFileExtensions: ['ts', 'js', 'json', 'node'],
      moduleNameMapper: {
        '^catalog_common$': '<rootDir>/../catalog_common/index',
      },
      transform: {
        '^.+\\.js$': ['ts-jest'],
      },
    },
  ],
};
