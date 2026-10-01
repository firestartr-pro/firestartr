export class Context {
  apiGroup: string;
  apiVersion: string;
  plural: string;
  namespace: string;

  githubOwner: string;
  githubRepo: string;

  constructor(
    apiGroup: string,
    apiVersion: string,
    plural: string,
    namespace: string,
    githubOwner: string,
    githubRepo: string,
  ) {
    this.apiGroup = apiGroup;
    this.apiVersion = apiVersion;
    this.plural = plural;
    this.namespace = namespace;
    this.githubOwner = githubOwner;
    this.githubRepo = githubRepo;
  }
}
