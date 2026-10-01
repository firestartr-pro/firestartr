jest.mock('../src/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../src/status', () => ({
  updateTransition: jest.fn(),
}));

jest.mock('../src/processItemDLH', () => ({
  deadLetterHandler: jest.fn(),
}));

jest.mock('../src/metricsServer', () => ({
  __esModule: true,
  default: jest.fn(),
  getProcessItemSlotMetrics: jest.fn(),
}));

jest.mock('../src/metrics/processItem.slot.metrics', () => ({
  ProcessItemSlotMetrics: jest.fn(),
}));

jest.mock('../src/metrics/processItem.global.metrics', () => ({
  ProcessorGlobalMetrics: {
    getInstance: jest.fn().mockReturnValue({
      recordProcessingDuration: jest.fn(),
    }),
    init: jest.fn(),
  },
}));

import {WorkItem, WorkStatus, OperationType} from '../src/definitions';

import {ProcessItemSlot, ProcessItemSlots, initProcessItemsSlots} from '../src/processItem.slot';

describe('Process slots handler', () => {

  let workItem: WorkItem;

  function mockWorkItem(sleepMS: number): WorkItem {

    // it should mock a work item
    return {
      item: {
        metadata: {
            name: 'test',
            namespace: 'default',
        },
      },
      getItem: function() {
        return this.item;
      },
      // i need to create a async generator function
      process: async function*() {
        await new Promise((resolve) => {
          setTimeout(() => {
            resolve(this.item);
          }, sleepMS);
        });
      },
      operation: OperationType.UPDATED,
      workStatus: WorkStatus.PENDING,
      onDelete: function() {
        this.workStatus = WorkStatus.FINISHED;
      },
      // mock a WorkItemHandler
      // with the needed properties for the test
      // and the rest with empty functions
      handler: {
        finalize: async function() {
          return {};
        },

        pluralKind: 'test',

        informPlan: async function() {},

        writeTerraformOutputInTfResult: async function() {
          return {};
        },

        writeConnectionSecret: async function() {},

        resolveReferences: async function() {
          return {};
        },

        resolveOwnOutputs: async function() {
          return undefined;
        },

        deleteSecret: async function() {
          return null;
        },

        itemPath: function() {
          return '';
        },

        error: async function() {},

        success: async function() {},

        recommendedTimeout: () => 1000,
      }
    }  
  }

  beforeEach(() => {

    workItem = mockWorkItem(100)

  });

  afterEach(() => {
  });

  describe('process item slot', () => {

    it('should be able to manage its own internal state', async () => {

        const pslot = new ProcessItemSlot(0);

        expect(pslot.idle).toBe(true);

        await pslot.runWorkItem(workItem);

        expect(pslot.idle).toBe(true);

    });

    it('should be able to be stocked with a work item and process it', async () => {

       const workItems = [mockWorkItem(100), mockWorkItem(200), mockWorkItem(300)];

       const pslots: ProcessItemSlots = initProcessItemsSlots(2, false);

       const runningPromises: Promise<void>[] = [];

       while(1){

         for (const slot of pslots.getIdleSlots()) {
           const workItem = workItems.shift();
           if (workItem) {
             runningPromises.push(slot.runWorkItem(workItem));
           }
           else{
             break;
           }
         }

         if (workItems.length === 0) {
           break;
         }else{
           await new Promise((resolve) => setTimeout(resolve, 50));
         }
       }

       await Promise.all(runningPromises);

    })
  });

});
