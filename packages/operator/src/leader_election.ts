import * as client from '@kubernetes/client-node';

import log from './logger';

async function getCurrentPod(namespace = 'default') {
  const { kc } = await getConnection();

  const k8sApi = kc.makeApiClient(client.CoreV1Api);

  const podName = hostname();

  const pod = await k8sApi.readNamespacedPod({ name: podName, namespace });

  return pod;
}

import { hostname } from 'os';

import { getConnection } from './ctl';

class LeaseAcquisitionError extends Error {
  constructor(message: string) {
    super(message);

    this.name = 'LeaseAcquisitionError';
  }
}

/*
 * This function tries to acquire or renew a lease in the cluster.
 * If the lease is already acquired by another pod, it throws an error.
 * If the lease is not found, it creates it.
 * If the pod that acquired the lease stops working, the lease will be released
 * automatically after 30 seconds.
 */
async function tryAcquireOrRenewLease(
  namespace: string,
  leaseDurationSeconds: number,
) {
  const { kc } = await getConnection();

  const k8sApi = kc.makeApiClient(client.CoordinationV1Api);

  const name = 'firestartr-lease';

  const currentPod = await getCurrentPod(namespace);

  try {
    log.debug(
      `Attempting to acquire the leader election lease for '${name}' in namespace '${namespace}'.`,
    );

    const lease = await k8sApi.readNamespacedLease({ name, namespace });

    const weAreTheLeader =
      lease.metadata.ownerReferences[0].uid === currentPod.metadata.uid;

    if (!weAreTheLeader) {
      log.debug(
        `Another pod has acquired the leader election lease for '${name}' in namespace '${namespace}'.`,
      );

      throw new LeaseAcquisitionError('Lease already acquired by another pod');
    }

    lease.spec.acquireTime =
      new Date().toISOString() as unknown as client.V1MicroTime;

    lease.spec.renewTime =
      new Date().toISOString() as unknown as client.V1MicroTime;

    lease.spec.leaseDurationSeconds = 30;

    log.debug(
      `Renewing the leader election lease for '${name}' in namespace '${namespace}'.`,
    );

    await k8sApi.replaceNamespacedLease({ name, namespace, body: lease });
  } catch (err: any) {
    if (err.code === 404 || err.statusCode === 404) {
      log.debug(
        `The leader election lease for '${name}' in namespace '${namespace}' was not found. Creating a new one.`,
      );

      const lease = {
        apiVersion: 'coordination.k8s.io/v1',

        kind: 'Lease',

        metadata: {
          name: name,

          namespace: namespace,

          ownerReferences: [
            {
              apiVersion: currentPod.apiVersion,

              kind: currentPod.kind,

              name: currentPod.metadata.name,

              uid: currentPod.metadata.uid,
            },
          ],
        },

        spec: {
          leaseDurationSeconds,
        },
      };

      await k8sApi.createNamespacedLease({ namespace, body: lease });

      log.debug(
        `A new leader election lease has been created for '${name}' in namespace '${namespace}'.`,
      );
    } else {
      log.debug(
        `An error occurred while renewing the leader election lease for '${name}' in namespace '${namespace}': '${err}'.`,
      );

      throw err;
    }
  }
}

/**
 * Whenever a pod acquires the lease, it will execute the callback. Otherwise, it will wait for the interval and try again.
 */
export async function acquireLease(
  namespace: string,

  cb: Function,

  interval = 10000,
) {
  try {
    await tryAcquireOrRenewLease(namespace, interval / 1000);

    log.debug(
      `Successfully acquired the leader election lease in namespace '${namespace}'. Executing the callback.`,
    );

    cb();
  } catch (err) {
    console.log(err);
    if (err instanceof LeaseAcquisitionError) {
      console.error(
        `Failed to acquire Lease, retrying in ${interval / 1000} seconds`,
      );
    }

    log.silly(
      `Failed to acquire the leader election lease; will retry in '${interval / 1000}' seconds.`,
    );

    await setTimeout(() => acquireLease(namespace, cb), interval);
  }
}
