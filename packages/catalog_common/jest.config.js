export default {
  rootDir: '.',
  verbose: true,
  projects: [
    {
      preset: 'ts-jest',
      testEnvironment: 'node',
      displayName: 'catalog_common',
      setupFilesAfterEnv: ['./setup.js'],
      testMatch: ['<rootDir>/__tests__/**/*test.ts'],
    },
  ],
};
