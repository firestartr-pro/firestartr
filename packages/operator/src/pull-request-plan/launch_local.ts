import { pullRequestPlan } from '.';

import dotenv from 'dotenv';

dotenv.config();

pullRequestPlan({
  owner: 'firestartr-test',
  repo: 'state-infra',
  prNumber: 380,
  namespace: 'dev',
  ref: 'user-j-patch-2',
})
  .then(() => {
    console.log('done');
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
