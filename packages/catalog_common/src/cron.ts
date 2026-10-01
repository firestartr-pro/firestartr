import { CronExpressionParser } from 'cron-parser';

const DEFAULT_TIME_ZONE = 'Europe/Madrid';

export function validateCron(cronLine: string, tz = DEFAULT_TIME_ZONE) {
  try {
    const interval = CronExpressionParser.parse(
      cronLine,

      {
        // to enable the only minutes cron
        strict: false,

        tz,
      },
    );

    return interval;
  } catch (err) {
    throw new Error(`validateCron: ${err}`);
  }
}

export function isValidCron(cronLine: string) {
  try {
    validateCron(cronLine);
  } catch (err) {
    return false;
  }
  return true;
}

export function getCronNextInterval(cronLine: string, tz?: string) {
  const interval = validateCron(cronLine, tz);

  return interval.next().toString();
}
