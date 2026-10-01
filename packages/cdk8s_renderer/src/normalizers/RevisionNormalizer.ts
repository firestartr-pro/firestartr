import { ICustomResourcePatch } from '../patches';
import { Normalizer, NormalizerError } from './base';

export class RevisionNormalizer extends Normalizer {
  applicableProviders = ['terraform', 'github'];

  async __validate(_schema: any): Promise<boolean> {
    return true;
  }

  async __patches(
    _claim: any,
    previousCR: any,
  ): Promise<ICustomResourcePatch[]> {
    const revisionKey = 'firestartr.dev/revision';

    return [
      {
        validate(_cr: any) {
          return true;
        },

        apply(cr: any) {
          if (
            previousCR &&
            previousCR.metadata.annotations &&
            previousCR.metadata.annotations[revisionKey]
          ) {
            cr.metadata.annotations = cr.metadata.annotations ?? {};

            let currentRevision = parseInt(
              previousCR.metadata.annotations[revisionKey],
              10,
            );

            if (isNaN(currentRevision)) {
              throw new NormalizerError(
                `INVALID_REVISION: '${cr.metadata.annotations[revisionKey]}'
              `,
              );
            }

            currentRevision += 1;

            cr.metadata.annotations[revisionKey] = currentRevision.toString();
          } else {
            cr.metadata.annotations[revisionKey] = '1';
          }

          return cr;
        },

        identify() {
          return 'normalizer/revision';
        },
      },
    ];
  }
}
