import common from 'catalog_common';
import { RenderedCrMap } from '../renderer/types';

const K8S_OBJECT_SIZE_LIMIT = 1572864; // 1.5 MiB in bytes, etcd recommended limit: https://etcd.io/docs/latest/dev-guide/limit/

export function validateCrSizes(crs: RenderedCrMap): void {
  for (const key of Object.keys(crs)) {
    const cr = crs[key];
    const serialized = common.io.toYaml(cr);
    const size = Buffer.byteLength(serialized, 'utf8');

    if (size > K8S_OBJECT_SIZE_LIMIT) {
      throw new Error(
        `CR "${cr.kind}-${cr.metadata.name}" exceeds the Kubernetes object size limit by ${size - K8S_OBJECT_SIZE_LIMIT} bytes. Maximum allowed is ${K8S_OBJECT_SIZE_LIMIT} bytes (1.5MiB).`,
      );
    }
  }
}
