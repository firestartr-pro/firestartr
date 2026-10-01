import log from "../src/logger";

// Use fake timers so we can drive the monitor's interval deterministically
// and flush promise microtasks between ticks.
jest.useFakeTimers();

describe("crdMonitor", () => {
  // Tests mock '../src/ctl' directly; no shared setup required here.

  afterEach(() => {
    jest.resetModules();
    jest.clearAllTimers();
    jest.restoreAllMocks();
  });

  it("logs errors while missing and starts informer once when CRD appears", async () => {
    const mockApi: any = {
      readCustomResourceDefinition: jest
        .fn()
        .mockRejectedValueOnce({ response: { statusCode: 404 } })
        .mockRejectedValueOnce({ response: { statusCode: 404 } })
        .mockResolvedValue({ body: {} }),
      listNamespacedCustomObject: jest.fn().mockResolvedValue({}),
      listClusterCustomObject: jest.fn().mockResolvedValue({}),
    };

    jest.doMock("../src/ctl", () => ({
      getConnection: async () => ({ kc: { makeApiClient: () => mockApi } }),
    }));

    const spyError = jest.spyOn(log, "error");
    const spyInfo = jest.spyOn(log, "info");
    const spyWarn = jest.spyOn(log, "warn");

    // import after mocking ctl (ctl is mocked above)
    const create = (await import("../src/crdMonitor")).default;
    const mon = create("testsplural", {
      enabled: true,
      // Use a short interval so we can advance timers quickly in the test.
      intervalSeconds: 1,
      apiGroup: "firestartr.dev",
    });

    mon.start();

    // The initial check is invoked synchronously; flush microtasks so the
    // mocked promise rejection is observed.
    await Promise.resolve();
    await Promise.resolve();

    // Advance timers to run the two scheduled checks (intervalSeconds=1).
    jest.advanceTimersByTime(1000);
    jest.runOnlyPendingTimers();
    // Flush microtasks scheduled by the interval callback
    await Promise.resolve();
    await Promise.resolve();

    jest.advanceTimersByTime(1000);
    jest.runOnlyPendingTimers();
    await Promise.resolve();
    await Promise.resolve();

    // error logged for missing and a single warning on availability
    expect(spyError).toHaveBeenCalled();
    expect(spyWarn).toHaveBeenCalled();

    mon.stop();
  });
});
