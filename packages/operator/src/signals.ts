import log from './logger';

export function initSignalsHandler(Mapper: Map<string, () => void>) {
  for (const [signal, callback] of Mapper.entries()) {
    log.info(
      `Setting up handler for signal ${signal}... on process with PID ${process.pid}`,
    );

    process.on(signal, async () => {
      log.info(`Received signal ${signal}, executing callback...`);
      try {
        await callback();
        log.info(`Callback for signal ${signal} executed successfully.`);
      } catch (err) {
        log.error(`Error executing callback for signal ${signal}:`, err);
      }
    });
  }
}
