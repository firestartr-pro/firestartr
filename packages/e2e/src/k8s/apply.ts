import { formatK8sError } from './errors';
import { getStatusCode, type StatusCodeError } from '../errors/status-code';
import {
  isCustomResource,
  parseApiVersion,
  resolveCustomResourceInfo,
} from './crd';
import common from 'catalog_common';
import {
  assertManifestPath,
  expandManifestList,
  formatResourceLabel,
  readManifestFile,
} from './manifests';
import { createLazyClients } from './lazy-clients';
import {
  assertNamespacedKind,
  resolveResourceNamespace,
  type K8sResource,
  type KubeConfigProvider,
} from './types';

export function createApplyFunction(
  getKubeConfig: KubeConfigProvider,
  defaultNamespace: string,
) {
  const clients = createLazyClients(getKubeConfig);

  async function applyCustomResource(obj: K8sResource): Promise<void> {
    const { group, version } = parseApiVersion(obj.apiVersion);
    const { plural, namespaced } = await resolveCustomResourceInfo(
      getKubeConfig,
      group,
      obj.kind,
    );

    const name = obj.metadata?.name;
    if (!name) return;

    if (!namespaced) {
      throw new Error(
        `Cluster-scoped custom resources are not supported: ${obj.kind}/${name}`,
      );
    }

    const ns = obj.metadata?.namespace;
    if (!ns) {
      throw new Error(
        `Namespace is required for ${obj.kind}/${name} (apiVersion ${obj.apiVersion})`,
      );
    }

    const customApi = clients.getCustomApi();

    try {
      await customApi.createNamespacedCustomObject({
        group,
        version,
        namespace: ns,
        plural,
        body: obj,
      });
      return;
    } catch (err) {
      const createErrMsg = formatK8sError(err as Error);
      common.logger.error(
        `K8s API create error for ${obj.kind}/${name} in namespace ${ns}: ${createErrMsg}`,
      );
      if (getStatusCode(err as StatusCodeError) !== 409) {
        throw new Error(
          `Failed to create ${obj.kind}/${name}: ${createErrMsg}`,
        );
      }
    }

    let currentResource: K8sResource;
    try {
      const response = await customApi.getNamespacedCustomObject({
        group,
        version,
        namespace: ns,
        plural,
        name,
      });
      currentResource = response as K8sResource;
    } catch (err) {
      if (getStatusCode(err as StatusCodeError) === 404) {
        common.logger.info(
          `CR ${obj.kind}/${name} in namespace ${ns} disappeared after 409; retrying create`,
        );
        try {
          await customApi.createNamespacedCustomObject({
            group,
            version,
            namespace: ns,
            plural,
            body: obj,
          });
          return;
        } catch (retryErr) {
          if (getStatusCode(retryErr as StatusCodeError) === 409) {
            const response2 = await customApi.getNamespacedCustomObject({
              group,
              version,
              namespace: ns,
              plural,
              name,
            });
            currentResource = response2 as K8sResource;
          } else {
            throw new Error(
              `Failed to recreate ${obj.kind}/${name}: ${formatK8sError(retryErr as Error)}`,
            );
          }
        }
      } else {
        common.logger.error(
          `K8s API read error for ${obj.kind}/${name} in namespace ${ns}: ${formatK8sError(err as Error)}`,
        );
        throw new Error(
          `Failed to read ${obj.kind}/${name}: ${formatK8sError(err as Error)}`,
        );
      }
    }

    const resourceVersion = currentResource.metadata?.resourceVersion;
    if (resourceVersion && obj.metadata) {
      obj.metadata.resourceVersion = resourceVersion;
    }

    if (currentResource.metadata?.finalizers && obj.metadata) {
      obj.metadata.finalizers = currentResource.metadata.finalizers;
    }

    try {
      await customApi.replaceNamespacedCustomObject({
        group,
        version,
        namespace: ns,
        plural,
        name,
        body: obj,
      });
    } catch (err) {
      common.logger.error(
        `K8s API replace error for ${obj.kind}/${name} in namespace ${ns}: ${formatK8sError(err as Error)}`,
      );
      throw new Error(
        `Failed to replace ${obj.kind}/${name}: ${formatK8sError(err as Error)}`,
      );
    }
  }

  async function applyStandardResource(obj: K8sResource): Promise<void> {
    const api = clients.getApi();

    try {
      await api.create(obj);
    } catch (err) {
      if (getStatusCode(err as StatusCodeError) !== 409) {
        throw err;
      }

      if (!obj.metadata?.name) {
        throw new Error('Resource name is required for read operation');
      }

      const readObj = {
        apiVersion: obj.apiVersion,
        kind: obj.kind,
        metadata: {
          name: obj.metadata.name,
          namespace: obj.metadata.namespace,
        },
      };

      const current = await api.read(readObj);
      const resourceVersion = (current as K8sResource).metadata
        ?.resourceVersion;

      if (resourceVersion) {
        obj.metadata = obj.metadata ?? {};
        obj.metadata.resourceVersion = resourceVersion;
      }

      await api.replace(obj);
    }
  }

  async function applyObject(
    obj: K8sResource,
    namespace?: string,
  ): Promise<void> {
    if (!obj || typeof obj !== 'object') return;
    if (!obj.apiVersion || !obj.kind) return;

    assertNamespacedKind(obj.kind);

    obj.metadata = obj.metadata ?? {};

    resolveResourceNamespace(obj, namespace);

    if (obj.metadata?.name) {
      const label = formatResourceLabel(
        obj.kind,
        obj.metadata.name,
        obj.metadata.namespace,
      );
      common.logger.info(`Applying ${label}`);
    }

    if (isCustomResource(obj.apiVersion)) {
      await applyCustomResource(obj);
    } else {
      await applyStandardResource(obj);
    }
  }

  return async function apply(
    inputPath: string,
    namespace?: string,
  ): Promise<void> {
    const targetNamespace = namespace ?? defaultNamespace;
    assertManifestPath(inputPath);
    const files = common.io.getFileListRecursively(
      inputPath,
      [],
      ['.yaml', '.yml'],
    );

    for (const file of files) {
      const parsed = await readManifestFile(file);
      const objects = expandManifestList(parsed);

      for (const obj of objects) {
        await applyObject(obj, targetNamespace);
      }
    }
  };
}
