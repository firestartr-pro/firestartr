import { CrsAnalyzer } from './src/analyzers/crs-analyzer';
import { Context } from './src/context';
import { KubernetesClient } from './src/kubernetes-client';
import { CrsPublisher } from './src/publishers/crs';
import { GithubClient } from './src/github-client';

async function runCrsAnalyzer(
  plural: string,
  namespace: string,
  org: string,
  repo: string,
) {
  const context = new Context(
    'firestartr.dev',
    'v1',
    plural,
    namespace,
    org,
    repo,
  );

  const analyzer = new CrsAnalyzer(context, new KubernetesClient());

  await analyzer.analyze();

  const publisher = new CrsPublisher(analyzer, new GithubClient(), context);

  await publisher.publish();

  if (publisher.output !== '') {
    console.log(publisher.output);
  }
}

export default { runCrsAnalyzer };
