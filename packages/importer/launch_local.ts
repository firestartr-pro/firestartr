import { runImporter } from '.';

void runImporter(
  false, // force

  true, // skipPlan

  '/tmp/claims',

  '/tmp/crs',

  '/tmp/config',

  '/tmp/defaults',

  'firestartr-test',
  [
    // 'gh-members,NAME=user-j',

    'gh-repo,NAME=test-import',

    // 'gh-group,SKIP=SKIP',
  ],
).then((r) => console.log(r));
