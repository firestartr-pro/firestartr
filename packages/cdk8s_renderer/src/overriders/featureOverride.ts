import { OverriderPatches } from './base';
import featuresPreparer from 'features_preparer';
import { renderFeature } from './utils';

import log from '../logger';

// this is the only way currently to make
// work the system and inject our code
// without having to download a feature
let MOCK_FEATURES_FN: Function | undefined;

export function MOCK_FEATURES(mock?: Function) {
  MOCK_FEATURES_FN = mock;

  if (mock) {
    log.warn(
      '⚠️ Warning features system downloader has been mocked, it should only happen in unit testing',
    );
  }
}

export class FeaturesOverrider extends OverriderPatches {
  applicableProviders = ['github'];

  private featureName: string;

  private featureVersion: string;

  private featureConfig: any = false;

  private featureArgs: any;

  private featureRepo = '';

  private featureRef = '';

  constructor(
    featureName: string,

    featureVersion: string,

    featureConfig?: any,

    featureArgs?: any,

    featureRef?: string,

    featureRepo?: string,
  ) {
    super();

    this.featureName = featureName;

    this.featureVersion = featureVersion;

    this.featureArgs = featureArgs || {};

    this.featureRef = featureRef || '';

    this.featureRepo = featureRepo || '';

    if (featureConfig) {
      this.featureConfig = featureConfig;
    }
  }

  getFeatureConfig(cr: any) {
    if (this.featureConfig) return this.featureConfig;

    return this.setUpAndRunRenderer(cr);
  }

  setUpAndRunRenderer(cr: any) {
    let repo = 'features';
    let owner = 'prefapp';
    let versionOrRef = this.featureVersion;
    let renderer = 'getFeatureConfig';

    if (MOCK_FEATURES_FN) {
      return MOCK_FEATURES_FN();
    }

    if (this.featureRepo) {
      [owner, repo] = this.featureRepo.split(/\//);
    }

    if (this.featureRef) {
      versionOrRef = this.featureRef;

      renderer = 'getFeatureConfigFromRef';
    }

    return featuresPreparer[renderer](
      this.featureName,

      versionOrRef,

      cr,

      this.featureArgs,

      repo,

      owner,
    );
  }

  async __validate() {
    return true;
  }

  async __patches(claim: any, _previousCR: any) {
    const featureName = this.featureName;

    const featureVersion = this.featureVersion || this.featureRef;

    const featureArgs = this.featureArgs;

    const fSetUpAndRunRenderer = function (target: any) {
      return this.setUpAndRunRenderer(target);
    }.bind(this);

    let renderedFeatureConfig: any = null;

    return [
      {
        validate(_cr: any) {
          return true;
        },

        async apply(cr: any) {
          renderedFeatureConfig = await fSetUpAndRunRenderer(claim);

          return cr;
        },

        identify() {
          return `feature/${featureName}`;
        },

        applicable() {
          return { applicableProviders: ['catalog', 'github'] };
        },

        async post(cr: any) {
          return renderFeature(
            featureName,

            featureVersion,

            renderedFeatureConfig,

            cr,

            claim.name,
          );
        },
      },
    ];
  }
}
