export default {
  rootDir: '.',
  verbose: true,
  projects: [
    {
      preset: 'ts-jest',
      testEnvironment: 'node',
      displayName: 'terraform_provisioner',
      setupFilesAfterEnv: ['./setup.js'],
      testMatch: ['<rootDir>/__tests__/**/*test.ts'],
    },
  ],
};
