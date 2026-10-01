import test from '.';
import dotenv from 'dotenv';

dotenv.config();

if (process.env.IS_DEV_LOCAL_ENVIRONMENT) {
  test
    .runCrsAnalyzer('tfworkspaces', 'dev', 'firestartr-test', 'claims')
    .then(() => console.log('done'));
}
