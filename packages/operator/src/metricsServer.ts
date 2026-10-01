import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { MeterProvider, MetricReader } from '@opentelemetry/sdk-metrics';
import { Meter } from '@opentelemetry/api';

import { getQueueMetrics } from './processItem';
import {
  getCurrentConcurrentApiCalls,
  getPendingApiCalls,
} from './utils/api-read-limiter';

import CRStateMetrics from './metrics/CRStates';
import { ProcessItemSlotMetrics } from './metrics/processItem.slot.metrics';
import { ProcessorGlobalMetrics } from './metrics/processItem.global.metrics';

let processMetricsSlotProvider: Function = null;

export default async function (kindList: string[], namespace: string) {
  const portFromEnv = process.env.METRICS_PORT;

  const options = PrometheusExporter.DEFAULT_OPTIONS;

  options.port = portFromEnv ? parseInt(portFromEnv) : options.port;

  options.endpoint = process.env.METRICS_ENDPOINT || options.endpoint;

  const exporter = new PrometheusExporter(
    options,

    () => {
      console.log(
        `📊 Metrics endpoint: http://localhost:${options.port}${options.endpoint}`,
      );
    },
  ) as any;
  const attributes = { pid: process.pid };

  void startMetrics(exporter, attributes, kindList, namespace);
}

async function startMetrics(
  exporter: MetricReader,
  attributes: any,
  kindList: string[],
  namespace: string,
) {
  const meterProvider = new MeterProvider({
    readers: [exporter],
  });

  const meter = meterProvider.getMeter('firestartr');

  void startQueueMetrics(meter, attributes);

  void startApiCallMetrics(meter, attributes);

  void startMemoryMetrics(meter, attributes);

  void startCRStates(meter, kindList, namespace);

  processMetricsSlotProvider = (slotId: number) => {
    return new ProcessItemSlotMetrics(slotId, meter);
  };

  ProcessorGlobalMetrics.init(meter);
}

// whenever a new slot is created, the ProcessItemSlotMetrics instance for that slot can be obtained by calling
// getProcessItemSlotMetrics(slotId)
export function getProcessItemSlotMetrics(slotId: number) {
  if (!processMetricsSlotProvider) {
    throw new Error('ProcessItemSlotMetrics provider not initialized');
  }

  return processMetricsSlotProvider(slotId);
}

async function startQueueMetrics(meter: Meter, attributes: any) {
  const nWorkItemsCounter = meter.createObservableGauge(
    'firestartr_workitems_total',

    { description: 'Number of workitems in the queue' },
  );

  const nWorkItemsPendingCounter = meter.createObservableGauge(
    'firestartr_workitems_pending_total',

    { description: 'Number of workitems with PENDING status in the queue' },
  );

  const nWorkItemsProcessingCounter = meter.createObservableGauge(
    'firestartr_workitems_processing_total',

    { description: 'Number of workitems with PROCESSING status in the queue' },
  );

  const nWorkItemsFinishedCounter = meter.createObservableGauge(
    'firestartr_workitems_finished_total',

    { description: 'Number of workitems with FINISHED status in the queue' },
  );

  const nWorkItemsInDeadLetterHandling = meter.createObservableGauge(
    'firestartr_workitems_dead_letter_handling_total',

    {
      description:
        'Number of workitems of the queue handled by the Dead Letter Handler',
    },
  );

  const nWorkItemsBlocked = meter.createObservableGauge(
    'firestartr_workitems_blocked_total',

    {
      description:
        'Number of workitems currently blocked (children still being deleted, or parent not yet created/provisioned)',
    },
  );

  const nWorkItemsDeferred = meter.createObservableGauge(
    'firestartr_workitems_deferred_total',

    {
      description:
        'Number of workitems moved to the deferred segment after repeated blocking',
    },
  );

  const queueMetrics: any = getQueueMetrics();

  let total = queueMetrics.nItems;

  let pending = queueMetrics.nItemsPending;

  let processing = queueMetrics.nItemsProcessing;

  let finished = queueMetrics.nItemsFinished;

  let inDeadLetterHandling = queueMetrics.nItemsInDeadLetterHandling;

  let nBlocked = queueMetrics.nItemsBlocked || 0;

  let nDeferred = queueMetrics.nItemsDeferred || 0;

  nWorkItemsCounter.addCallback((observer) =>
    observer.observe(total, { ...attributes, ...queueMetrics.nItemsTypes }),
  );

  nWorkItemsPendingCounter.addCallback((observer) =>
    observer.observe(pending, { ...attributes, ...queueMetrics.nItemsTypes }),
  );

  nWorkItemsProcessingCounter.addCallback((observer) =>
    observer.observe(processing, {
      ...attributes,
      ...queueMetrics.nItemsTypes,
    }),
  );

  nWorkItemsFinishedCounter.addCallback((observer) =>
    observer.observe(finished, { ...attributes, ...queueMetrics.nItemsTypes }),
  );

  nWorkItemsInDeadLetterHandling.addCallback((observer) =>
    observer.observe(inDeadLetterHandling, {
      ...attributes,
      ...queueMetrics.nItemsTypes,
    }),
  );

  nWorkItemsBlocked.addCallback((observer) =>
    observer.observe(nBlocked, { ...attributes }),
  );

  nWorkItemsDeferred.addCallback((observer) =>
    observer.observe(nDeferred, { ...attributes }),
  );

  setInterval(
    () => {
      const queueMetrics: any = getQueueMetrics();

      total = queueMetrics.nItems;

      pending = queueMetrics.nItemsPending;

      processing = queueMetrics.nItemsProcessing;

      finished = queueMetrics.nItemsFinished;

      inDeadLetterHandling = queueMetrics.nItemsInDeadLetterHandling;

      nBlocked = queueMetrics.nItemsBlocked || 0;

      nDeferred = queueMetrics.nItemsDeferred || 0;
    },

    1000,
  );
}

async function startApiCallMetrics(meter: Meter, attributes: any) {
  const concurrentGauge = meter.createObservableGauge(
    'firestartr_api_calls_concurrent',

    { description: 'Current number of in-flight Kubernetes API read calls' },
  );

  const awaitingGauge = meter.createObservableGauge(
    'firestartr_api_calls_awaiting',

    {
      description:
        'Current number of Kubernetes API read calls waiting for a slot',
    },
  );

  concurrentGauge.addCallback((observer) =>
    observer.observe(getCurrentConcurrentApiCalls(), attributes),
  );

  awaitingGauge.addCallback((observer) =>
    observer.observe(getPendingApiCalls(), attributes),
  );
}

async function startMemoryMetrics(meter: Meter, attributes: any) {
  const usedMemoryCounter = meter.createObservableGauge(
    'firestartr_used_memory',

    { description: 'Used memory in bytes' },
  );

  let heapUsage = process.memoryUsage().heapUsed;

  usedMemoryCounter.addCallback((observer) =>
    observer.observe(heapUsage, attributes),
  );

  setInterval(
    () => {
      heapUsage = process.memoryUsage().heapUsed;
    },

    1000,
  );
}

async function startCRStates(
  meter: Meter,
  kindList: string[],
  namespace: string,
) {
  for (const kind of kindList) {
    const crStateMetrics = new CRStateMetrics(kind, namespace, meter);
    await crStateMetrics.start();
  }
}
