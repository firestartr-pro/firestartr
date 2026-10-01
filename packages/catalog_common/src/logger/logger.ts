import winston, { format, transports } from 'winston';

import { fixCircularReferences } from './utils';

type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'verbose' | 'silly';

const validLogLevels: LogLevel[] = [
  'error',
  'warn',
  'info',
  'debug',
  'verbose',
  'silly',
];

let initiated = false;

let logger = null;

// Type guard to check if a value is a valid LogLevel
function isValidLogLevel(level: string | undefined): level is LogLevel {
  return (
    typeof level === 'string' && validLogLevels.includes(level as LogLevel)
  );
}

/**
 * Enables file logging and sets the file log level to 'silly'.
 * @param filename - The path to the log file (e.g., 'combined.log')
 */
export function enableFileLogging(filename = 'app.log'): void {
  // 1. Ensure the logger is initialized first
  initLogger();

  if (logger) {
    // 2. Add the new File transport
    logger.add(
      new transports.File({
        filename,
        level: 'silly', // This transport specifically captures everything
      }),
    );

    // Optional: Log a confirmation
    doLog('info', [`File logging enabled at ${filename} with level 'silly'`]);
  }
}

export function disableFileLogging(): void {
  if (logger) {
    // 2. Find and remove all File transports
    const fileTransports = logger.transports.filter(
      (t) => t instanceof transports.File,
    );

    fileTransports.forEach((t) => {
      logger.remove(t);
    });
  }
}

function initLogger() {
  if (initiated) return;

  const logLevel =
    process.env.LOG_LEVEL && isValidLogLevel(process.env.LOG_LEVEL)
      ? process.env.LOG_LEVEL
      : 'info';

  const useJson = String(process.env.CI).toLowerCase() !== 'true';

  const humanFormat = format.printf((info) => {
    const level = info[Symbol.for('level')] as string; // raw, not colorized
    const msg =
      typeof info.message === 'string'
        ? info.message
        : JSON.stringify(info.message);

    if (level === 'error') return `::error::${msg}`;
    if (level === 'warn') return `::warning::${msg}`;

    return `[${info.level}]: ${msg}`;
  });

  logger = winston.createLogger({
    level: logLevel,
    exitOnError: false,
    format: useJson
      ? format.combine(
          format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
          format.json(),
        )
      : format.combine(format.colorize(), humanFormat),
    transports: [new transports.Console({ level: logLevel })],
  });

  initiated = true;
}

function doLog(level: LogLevel, args: any[]) {
  initLogger();

  const [message, data] = args;

  let finalMessage = message;

  if (data) {
    const fx = fixCircularReferences(data.metadata);

    try {
      finalMessage =
        finalMessage + ' | ' + JSON.stringify(data?.metadata, fx, 2);
    } catch (err) {
      console.error(`Serializing ${message}: ${err}`);

      return;
    }
  }

  logger[level].apply(logger, [finalMessage]);
}

const log = {
  error: (...args: any) => doLog('error', args),
  warn: (...args: any) => doLog('warn', args),
  info: (...args: any) => doLog('info', args),
  debug: (...args: any) => doLog('debug', args),
  verbose: (...args: any) => doLog('verbose', args),
  silly: (...args: any) => doLog('silly', args),
  enableFileLogging,
  disableFileLogging,
};

export default log;
