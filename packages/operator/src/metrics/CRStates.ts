import { CustomObjectsApi, ApiextensionsV1Api } from '@kubernetes/client-node';
import { MeterProvider, MetricReader } from '@opentelemetry/sdk-metrics';
import { Meter } from '@opentelemetry/api';
import { getConnection } from '../ctl';

import { SYNC_DEFAULT_ERROR_MESSAGE } from '../utils/operationErrorMessages';

import log from '../logger';

const INTERVAL_IN_SEGS = 60;

// Define the expected response structure
interface K8sListResponse<T> {
  items: T[];
}

interface CustomResource {
  metadata?: {
    name?: string;
    namespace?: string;
    [key: string]: any;
  };
  spec?: {
    [key: string]: any;
  };
  [key: string]: any; // For flexibility, if CRD structure varies
}

export default class CRStateMetrics {
  kind: string;
  updateInterval: any;
  provisionedGauge: any;
  provisioningGauge: any;
  outOfSyncGauge: any;
  planningGauge: any;
  deletedGauge: any;
  errorGauge: any;
  errorOnSyncGauge: any;
  onUpdate: boolean;
  namespace: string;

  kc: any;
  fListCRs: Function;

  constructor(kind: string, namespace: string, meter: Meter) {
    this.kind = kind;

    this.provisionedGauge = meter.createGauge('firestartr_provisioned_total', {
      description: 'Total number of CRs in PROVISIONED state',
    });

    this.provisioningGauge = meter.createGauge(
      'firestartr_provisioning_total',
      {
        description: 'Total number of CRs in PROVISIONING state',
      },
    );

    this.outOfSyncGauge = meter.createGauge('firestartr_out_of_sync_total', {
      description: 'Total number of CRs in OUT_OF_SYNC state',
    });

    this.errorGauge = meter.createGauge('firestartr_error_total', {
      description: 'Total number of CRs in ERROR state',
    });

    this.planningGauge = meter.createGauge('firestartr_planning_total', {
      description: 'Total number of CRs in PLANNING state',
    });

    this.deletedGauge = meter.createGauge('firestartr_deleted_total', {
      description: 'Total number of CRs in DELETED state',
    });

    this.errorOnSyncGauge = meter.createGauge(
      'firestartr_error_on_sync_total',
      {
        description: 'Total number of CRs with failed SYNCs',
      },
    );

    this.namespace = namespace;
  }

  async start() {
    await this.__prepareConnection();

    this.onUpdate = false;

    this.updateInterval = setInterval(async () => {
      await this.update();
    }, 1000 * INTERVAL_IN_SEGS);

    await this.update();
  }

  stop() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);

      this.updateInterval = null;
    }
  }

  async update() {
    if (this.onUpdate) return;

    this.onUpdate = true;

    try {
      const items = await this.fListCRs();

      let provisionedCount = 0;
      let provisioningCount = 0;
      let outOfSyncCount = 0;
      let errorCount = 0;
      let planningCount = 0;
      let deletedCount = 0;
      let errorOnSyncCount = 0;

      for (const item of items) {
        const status = item.status?.conditions.find(
          (condition: any) =>
            condition.type !== 'SYNCHRONIZED' && condition.status === 'True',
        );

        if (!status) continue;

        const syncCondition = item.status.conditions.find((condition: any) => {
          return condition.type === 'SYNCHRONIZED';
        });

        if (
          syncCondition &&
          syncCondition.message === SYNC_DEFAULT_ERROR_MESSAGE
        ) {
          errorOnSyncCount++;
        }

        switch (status.type) {
          case 'PROVISIONED':
            provisionedCount++;
            break;
          case 'PROVISIONING':
            provisioningCount++;
            break;
          case 'OUT_OF_SYNC':
            outOfSyncCount++;
            break;
          case 'PLANNING':
            planningCount++;
            break;
          case 'DELETED':
            deletedCount++;
            break;
          case 'ERROR':
            errorCount++;
            break;
        }
      }

      this.provisionedGauge.record(provisionedCount, {
        namespace: this.namespace,
        kind: this.kind,
      });
      this.provisioningGauge.record(provisioningCount, {
        namespace: this.namespace,
        kind: this.kind,
      });
      this.planningGauge.record(planningCount, {
        namespace: this.namespace,
        kind: this.kind,
      });
      this.deletedGauge.record(deletedCount, {
        namespace: this.namespace,
        kind: this.kind,
      });
      this.outOfSyncGauge.record(outOfSyncCount, {
        namespace: this.namespace,
        kind: this.kind,
      });
      this.errorGauge.record(errorCount, {
        namespace: this.namespace,
        kind: this.kind,
      });

      this.errorOnSyncGauge.record(errorOnSyncCount, {
        namespace: this.namespace,
        kind: this.kind,
      });
    } catch (err) {
      console.log(`CRStateMetrics: update ${err}`);

      this.onUpdate = false;

      log.error(`On update of CR metrics: ${err}`);

      await this.__prepareConnection();
    }

    this.onUpdate = false;
  }

  async __prepareConnection() {
    const { kc, opts } = await getConnection();

    const k8sApi = kc.makeApiClient(CustomObjectsApi);

    // Attempt to read the CRD to find the served version and scope. If the
    // read fails, fall back to v1 namespaced behaviour as before.
    let apiVersion = 'v1';
    let scope: 'Namespaced' | 'Cluster' = 'Namespaced';
    try {
      const apix = kc.makeApiClient(ApiextensionsV1Api);
      const name = `${this.kind}.firestartr.dev`;
      const crdResp = await (apix as any).readCustomResourceDefinition(name);
      const crdBody = crdResp?.body ?? crdResp;
      const versions: Array<any> = crdBody?.spec?.versions || [];
      apiVersion =
        versions.find((v: any) => v?.served)?.name ||
        crdBody?.spec?.version ||
        apiVersion;
      scope = (crdBody?.spec?.scope as any) || scope;
    } catch (e) {
      log.debug(
        `CRStateMetrics: failed to read CRD for '${this.kind}': ${e} — falling back to apiVersion='${apiVersion}', scope='${scope}'`,
      );
    }

    this.fListCRs = async (): Promise<CustomResource[]> => {
      try {
        let response: any;
        if (scope === 'Cluster') {
          response = await k8sApi.listClusterCustomObject({
            group: 'firestartr.dev',
            version: apiVersion,
            plural: this.kind,
          } as any);
        } else {
          response = await k8sApi.listNamespacedCustomObject({
            group: 'firestartr.dev',
            version: apiVersion,
            namespace: this.namespace,
            plural: this.kind,
          } as any);
        }

        const body = response as K8sListResponse<CustomResource>;
        return body.items;
      } catch (err) {
        throw new Error(`On listing CRs ${this.kind}: ${err}`);
      }
    };
  }
}
