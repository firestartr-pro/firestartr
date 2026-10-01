import * as K8s from '@kubernetes/client-node';
export class KubernetesClient {
  client: K8s.CustomObjectsApi;

  constructor() {
    const kc = new K8s.KubeConfig();

    kc.loadFromDefault();

    this.client = kc.makeApiClient(K8s.CustomObjectsApi);
  }

  async listKind(
    apiGroup: string,
    apiVersion: string,
    namespace: string,
    plural: string,
  ) {
    const response = await this.client.listNamespacedCustomObject({
      group: apiGroup,
      version: apiVersion,
      namespace,
      plural,
    });

    return (response as any).items;
  }
}
