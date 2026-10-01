import { InitializerPatches } from './base';
import common from 'catalog_common';

import { helperCTX } from '../patches';

const PERIOD_VALIDATOR = new RegExp(/^\d+[smhd]$/);

const SYNC_SCHED_ANNOTATION = 'firestartr.dev/sync-schedule';
const SYNC_SCHED_TIMEZONE_ANNOTATION = 'firestartr.dev/sync-schedule-timezone';

const SYNC_SCHED_TIMEZONE_DEFAULT = 'Europe/Madrid';

function helperHasSyncSchedule(cr: any) {
  return !!cr?.metadata?.annotations?.[SYNC_SCHED_ANNOTATION];
}

function helperHasSyncScheduleTz(cr: any) {
  return !!cr?.metadata?.annotations?.[SYNC_SCHED_TIMEZONE_ANNOTATION];
}

export class SyncerInitializer extends InitializerPatches {
  applicableProviders = ['^catalog'];

  static applicableKinds = [
    'ComponentClaim',
    'GroupClaim',
    'UserClaim',
    'TFWorkspaceClaim',
    'OrgWebhookClaim',
  ];

  async __validate() {
    return true;
  }

  async __patches(claim: any, _previousCR: any) {
    function syncInfo(ctx: any) {
      const provider: string = helperCTX(ctx).provider;

      return claim.providers[provider].sync || {};
    }

    return [
      {
        validate(cr: any) {
          if (
            cr.metadata.annotations &&
            cr.metadata.annotations['firestartr.dev/sync-policy'] &&
            cr.metadata.annotations['firestartr.dev/policy']
          ) {
            const policy = cr.metadata.annotations['firestartr.dev/policy'];

            const syncPolicy =
              cr.metadata.annotations['firestartr.dev/sync-policy'];

            const policiesAreCompatible = common.policies.policiesAreCompatible(
              syncPolicy,

              policy,
            );

            if (!policiesAreCompatible) {
              throw `${this.identify()}: incompatible policies '${policy}' and '${syncPolicy}' for ${helperCTX(this).kind}/${cr.metadata.name}`;
            }
          }

          if (
            cr.metadata.annotations &&
            cr.metadata.annotations['firestartr.dev/sync-period']
          ) {
            if (
              !PERIOD_VALIDATOR.test(
                cr.metadata.annotations['firestartr.dev/sync-period'],
              )
            ) {
              throw `${this.identify()}: period incorrect '${cr.metadata.annotations['firestartr.dev/sync-period']}' for ${cr.kind}/${cr.metadata.name}`;
            }
            return true;
          } else if (helperHasSyncSchedule(cr)) {
            if (
              !common.cron.isValidCron(
                cr.metadata.annotations[SYNC_SCHED_ANNOTATION],
              )
            ) {
              throw `${this.identify()}: sync-schedule: cron incorrect '${cr.metadata.annotations[SYNC_SCHED_ANNOTATION]}' for ${cr.kind}/${cr.metadata.name}`;
            }
          } else {
            return true;
          }
        },

        apply(cr: any) {
          if (syncInfo(this).enabled) {
            cr.metadata.annotations = cr.metadata.annotations || {};

            cr.metadata.annotations['firestartr.dev/sync-enabled'] = 'true';

            if (syncInfo(this).period) {
              cr.metadata.annotations = cr.metadata.annotations || {};

              cr.metadata.annotations['firestartr.dev/sync-period'] =
                syncInfo(this).period;
            }

            if (syncInfo(this).policy) {
              cr.metadata.annotations = cr.metadata.annotations || {};

              cr.metadata.annotations['firestartr.dev/sync-policy'] =
                syncInfo(this).policy;
            }

            if (syncInfo(this).schedule) {
              cr.metadata.annotations = cr.metadata.annotations || {};

              cr.metadata.annotations[SYNC_SCHED_ANNOTATION] =
                syncInfo(this).schedule;

              cr.metadata.annotations[SYNC_SCHED_TIMEZONE_ANNOTATION] =
                syncInfo(this).schedule_timezone || SYNC_SCHED_TIMEZONE_DEFAULT;
            }
          }

          return cr;
        },

        identify() {
          return 'initializers/SyncerInitializer';
        },
      },
    ];
  }
}
