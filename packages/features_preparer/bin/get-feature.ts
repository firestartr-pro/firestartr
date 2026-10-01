#!/usr/bin/env tsx

import { getFeatureConfigFromRef, downloadFeatureZip } from '../src/installer';

import { argv } from 'node:process';

import log from '../src/logger';

const [featureName, versionOrRef] = argv.slice(2);

log.info(`Getting feature '${featureName}' (${versionOrRef})`);

getFeatureConfigFromRef(
  featureName,
  versionOrRef,
  {
    apiVersion: 'firestartr.dev/v1',
    kind: 'FirestartrGithubRepository',
    metadata: {
      name: 'test',
    },
  },
  {},
  'features',
  'prefapp',
)
  .then(() => {
    console.log('OK!');
  })
  .catch((err) => {
    console.log(err);

    process.exit(1);
  });
