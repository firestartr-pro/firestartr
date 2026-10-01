import { ICustomResourcePatch, helperCTX } from '../patches';
import { Normalizer, NormalizerError } from './base';
import common from 'catalog_common';
import _ from 'lodash';

export class NameNormalizer extends Normalizer {
  applicableProviders = ['all'];

  async __validate(_schema: any): Promise<boolean> {
    return true;
  }

  async __patches(
    claim: any,
    previousCR: any,
  ): Promise<ICustomResourcePatch[]> {
    let normalizedName: string;

    const fNormalizeName = (name: string) => {
      const normalizedName: string = this.normalizeNameCharacters(
        this.normalizeNameLength(name),
      );

      const isValidNameRegex =
        /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;

      if (!isValidNameRegex.test(normalizedName)) {
        throw new NormalizerError(`INVALID_NAME: '${name}'`);
      }

      return normalizedName;
    };

    return [
      {
        validate(cr: any) {
          return cr.metadata.name === normalizedName;
        },

        apply(cr: any) {
          cr.metadata.annotations = cr.metadata.annotations ?? {};

          const provider = helperCTX(this).provider;

          const annotation =
            common.generic.getFirestartrAnnotation('external-name');

          const providerName = claim.providers[provider].name;

          if (previousCR && !_.isEmpty(previousCR)) {
            cr.metadata.annotations[annotation] = providerName;

            cr.metadata.name = previousCR.metadata.name;

            if (
              previousCR.writeConnectionSecretToRef &&
              !_.isEmpty(previousCR.writeConnectionSecretToRef)
            ) {
              cr.writeConnectionSecretToRef.name =
                previousCR.writeConnectionSecretToRef.name;
            }

            return cr;
          }

          normalizedName = fNormalizeName(providerName);

          cr.metadata.annotations[annotation] = providerName;

          cr.metadata.name = normalizedName;

          return cr;
        },

        identify() {
          return 'normalizer/name';
        },

        applicable() {
          return {
            applicableProviders: ['^catalog'],
          };
        },
      },

      {
        validate(cr: any) {
          return cr.metadata.name === normalizedName;
        },

        apply(cr: any) {
          cr.metadata.annotations = cr.metadata.annotations ?? {};

          const annotation = 'title';

          const providerName = claim.name;

          // If provider is catalog, we don't need to check previousCR

          normalizedName = fNormalizeName(providerName);

          cr.metadata.annotations[annotation] = providerName;

          cr.metadata.name = normalizedName;

          return cr;
        },

        identify() {
          return 'normalizer/name';
        },

        applicable() {
          return {
            applicableProviders: ['catalog'],
          };
        },
      },
    ];
  }

  normalizeNameCharacters(name: string) {
    name = name.toLowerCase();

    const regex = /[^a-zA-Z0-9-]/g;

    const regexBegins = /^-+/;

    const regexEnd = /-+$/;

    let replaced = name.replace(regex, '-');

    replaced = replaced.replace(regexBegins, '');

    replaced = replaced.replace(regexEnd, '');

    return replaced;
  }

  normalizeNameLength(name: string) {
    return name.substring(0, 200);
  }
}
