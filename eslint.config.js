import globals from 'globals';
import gts from 'gts';

export default [
  {
    ignores: [
      '**/build/',
      '**/dist/',
      '**/__tests__/',
      // These packages never ignored their tests; keep linting them.
      '!packages/crs_status_service/__tests__/',
      '!packages/e2e/__tests__/',
      '!packages/test-reporter/__tests__/',
      '**/node_modules/',
      'packages/gh_provisioner/**/*.js',
      'packages/cdk8s_renderer/imports/',
      'packages/crs_analyzer/launch_local.ts',
      'packages/features_renderer/bin/',
      'packages/fs-forge-cli/bin/',
      'packages/fs-forge-cli/schemas/',
      'packages/gh_provisioner/**/__mocks__',
      'packages/operator/launch_dev_test.ts',
      'packages/operator/dist_external/',
    ],
  },
  ...gts,
  {
    files: ['**/*.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      '@typescript-eslint/no-explicit-any': ['off'],
      '@typescript-eslint/no-unused-vars': ['off'],
      'prettier/prettier': ['error'],
      '@typescript-eslint/no-this-alias': ['off'],
      '@typescript-eslint/no-empty-interface': ['off'],
      'no-constant-condition': ['error', { checkLoops: false }],
      'n/no-process-exit': ['off'],
      // New in gts 7 recommended sets; off until fixed in #2803.
      '@typescript-eslint/no-unsafe-function-type': ['off'],
      '@typescript-eslint/no-unsafe-declaration-merging': ['off'],
      '@typescript-eslint/no-unused-expressions': ['off'],
    },
  },
];
