import { getAffectedRepositories } from '.';

void getAffectedRepositories(
  '/tmp/mainclaims',
  '/tmp/prclaims',
  '/library/packages/cdk8s_renderer/__tests__/fixtures/wetreposconfig/config.yaml',
).then((result) => {
  console.log(JSON.stringify(result, null, 4));
});
