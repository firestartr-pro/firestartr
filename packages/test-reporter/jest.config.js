export default {
  rootDir: '.',
  verbose: true,
  projects: [
    {
      preset: 'ts-jest',
      testEnvironment: 'node',
      displayName: 'test-reporter',
      testMatch: ['<rootDir>/__tests__/*.test.ts'],
      moduleFileExtensions: ['ts', 'js', 'json', 'node'],
      transform: {
        '^.+\\.js$': ['ts-jest'],
      },
    },
  ],
};
