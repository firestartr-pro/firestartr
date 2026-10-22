# Changelog

## [3.1.0](https://github.com/firestartr-pro/firestartr/compare/v3.0.2...v3.1.0) (2026-10-22)


### Features

* **`cdk8s_renderer`:** add benchmark tools ([#89](https://github.com/firestartr-pro/firestartr/issues/89)) ([a58c977](https://github.com/firestartr-pro/firestartr/commit/a58c977a988d0ac2505a591734e4536b5fdc168e))
* error control of missing deps ([3eb6b12](https://github.com/firestartr-pro/firestartr/commit/3eb6b12e11e34f4fa768d8a942073e85cf4dec07))
* error control of missing deps at the operator level ([3eb6b12](https://github.com/firestartr-pro/firestartr/commit/3eb6b12e11e34f4fa768d8a942073e85cf4dec07))
* error control y absence deps ([008ea34](https://github.com/firestartr-pro/firestartr/commit/008ea34dcd234032d8431a1991be7ba89ad9a4f9))


### Bug Fixes

* **`cdk8s_renderer`:** reduced rendering load time ([#88](https://github.com/firestartr-pro/firestartr/issues/88)) ([fbd4b02](https://github.com/firestartr-pro/firestartr/commit/fbd4b027055c134ece1a85411ce059ffd4e6ec1a))
* add per-execution separated deps resolver ([2f65edc](https://github.com/firestartr-pro/firestartr/commit/2f65edc872d2db043fb4f139d0b3b9fff208d0e4))
* add per-execution separated deps resolver ([2f65edc](https://github.com/firestartr-pro/firestartr/commit/2f65edc872d2db043fb4f139d0b3b9fff208d0e4))
* add per-slot separate deps resolver ([070c543](https://github.com/firestartr-pro/firestartr/commit/070c5430c2fe484c98b201e4974a662f0b92cc7e))
* address copilot review on absent-dependency error handling ([84d01e6](https://github.com/firestartr-pro/firestartr/commit/84d01e63604f9d9da84e43745c133ed52d18677b))
* close needsSecret cache bypass and prototype-key output reads ([d48aa9a](https://github.com/firestartr-pro/firestartr/commit/d48aa9a73edab4095f753745b8a9870177174c17))
* **deps-dev:** bump @types/lodash from 4.17.25 to 4.17.26 ([#73](https://github.com/firestartr-pro/firestartr/issues/73)) ([974a986](https://github.com/firestartr-pro/firestartr/commit/974a9865a678af3635adfd9499fb8e1260d5c8de))
* **deps-dev:** bump cdk8s-cli from 2.207.64 to 2.207.67 ([#91](https://github.com/firestartr-pro/firestartr/issues/91)) ([5f7f01f](https://github.com/firestartr-pro/firestartr/commit/5f7f01f92654304226a445350f2156aa481433ed))
* **deps-dev:** bump eslint-plugin-prettier from 5.5.6 to 5.5.7 ([#95](https://github.com/firestartr-pro/firestartr/issues/95)) ([229a655](https://github.com/firestartr-pro/firestartr/commit/229a6554222366f2820b86d130dcb83d1326e69e))
* **deps:** bump @opentelemetry/exporter-prometheus ([#75](https://github.com/firestartr-pro/firestartr/issues/75)) ([0e5be52](https://github.com/firestartr-pro/firestartr/commit/0e5be52be58b525968683abdb1ef03618f0cd06a))
* **deps:** bump @opentelemetry/sdk-metrics from 2.11.0 to 2.12.0 ([#79](https://github.com/firestartr-pro/firestartr/issues/79)) ([cf76b73](https://github.com/firestartr-pro/firestartr/commit/cf76b7361c90a06da9378633b6b03a252ffc8a59))
* **deps:** bump cdk8s from 2.70.108 to 2.70.109 ([7e99ee1](https://github.com/firestartr-pro/firestartr/commit/7e99ee111e985d5df96ba5b7dcc436ea4eaafc51))
* **deps:** bump cdk8s from 2.70.109 to 2.70.111 ([#90](https://github.com/firestartr-pro/firestartr/issues/90)) ([40ea085](https://github.com/firestartr-pro/firestartr/commit/40ea0857c0039ad6470ab0c0a367ab0af32061cf))
* **deps:** bump cdk8s-cli from 2.207.63 to 2.207.64 ([#81](https://github.com/firestartr-pro/firestartr/issues/81)) ([0b079de](https://github.com/firestartr-pro/firestartr/commit/0b079de1d72f91df779f0dd1c9b380626bd73646))
* **deps:** bump dotenv from 18.0.5 to 18.0.7 ([#74](https://github.com/firestartr-pro/firestartr/issues/74)) ([5afa0a3](https://github.com/firestartr-pro/firestartr/commit/5afa0a3e5aeb25705b6ac1a80777d46882a92ef9))
* **deps:** bump dotenv from 18.0.7 to 18.0.8 ([#96](https://github.com/firestartr-pro/firestartr/issues/96)) ([237c633](https://github.com/firestartr-pro/firestartr/commit/237c6338f4da695236a240c17cfcb11f61e55994))
* **deps:** bump express from 4.22.1 to 5.2.1 ([658469c](https://github.com/firestartr-pro/firestartr/commit/658469c91403635aa6d42336b0e962e8ad2712ed))
* **deps:** bump express from 4.22.1 to 5.2.1 ([b21d847](https://github.com/firestartr-pro/firestartr/commit/b21d847011946a16ad953d24f5061bab06812348))
* **deps:** bump express from 5.2.1 to 5.3.0 ([#76](https://github.com/firestartr-pro/firestartr/issues/76)) ([b5f8a92](https://github.com/firestartr-pro/firestartr/commit/b5f8a924bd6adba9dba55b76412b782de1171865))
* **deps:** bump handlebars from 4.7.9 to 4.7.10 ([#70](https://github.com/firestartr-pro/firestartr/issues/70)) ([c504e1b](https://github.com/firestartr-pro/firestartr/commit/c504e1b3a7c6f9adbf86ecff234d77ce30b0b66a))
* **deps:** bump proxy-addr from 2.0.7 to 2.0.8 ([#62](https://github.com/firestartr-pro/firestartr/issues/62)) ([7d8128e](https://github.com/firestartr-pro/firestartr/commit/7d8128e45b71f36ce0a1feff785f8acf81de0806))
* **deps:** bump ts-jest from 29.4.14 to 29.4.15 ([#97](https://github.com/firestartr-pro/firestartr/issues/97)) ([b8fb125](https://github.com/firestartr-pro/firestartr/commit/b8fb1251b37fe815a62237a64ee3a48728b1aa4b))
* **e2e:** add the group parent so fixtures without one can be patched ([cf06db4](https://github.com/firestartr-pro/firestartr/commit/cf06db47d7a812de31748cd46565d4fd45da9805))
* **e2e:** clone render artifacts in the claims snapshot ([5ac292b](https://github.com/firestartr-pro/firestartr/commit/5ac292b89be2e8dc0b78f989fa503c2d9ffc8196))
* **e2e:** prepare the verification workflow once per repository ([032c7a4](https://github.com/firestartr-pro/firestartr/commit/032c7a4c0df99fbdd3a34a30c1dd8e4b411ff17d))
* **features_renderer:** restore bin/validate.js ([#44](https://github.com/firestartr-pro/firestartr/issues/44)) ([80eb86f](https://github.com/firestartr-pro/firestartr/commit/80eb86f8a879cdebea75cfb47fc11022fbc602a2))
* guard secret data before credential lookup ([8bd1ee4](https://github.com/firestartr-pro/firestartr/commit/8bd1ee4ab6fd325af5a3d77f8b8cda86b251fa9c))
* remove firestartrterraformworkspaceplan ([#57](https://github.com/firestartr-pro/firestartr/issues/57)) ([64fa2c0](https://github.com/firestartr-pro/firestartr/commit/64fa2c0e2667387d327daca9afbc62bfb48940a9))

## [3.0.2](https://github.com/firestartr-pro/firestartr/compare/v3.0.1...v3.0.2) (2026-10-02)


### Bug Fixes

* **cdk8s_renderer:** add repository metadata to generated claims_schemas package ([#39](https://github.com/firestartr-pro/firestartr/issues/39)) ([1a9736c](https://github.com/firestartr-pro/firestartr/commit/1a9736c25695b8d634b0bd7848c076ff6ed7fabc))

## [3.0.1](https://github.com/firestartr-pro/firestartr/compare/v3.0.0...v3.0.1) (2026-10-02)


### Bug Fixes

* sync package json files config to public ([#34](https://github.com/firestartr-pro/firestartr/issues/34)) ([c4479db](https://github.com/firestartr-pro/firestartr/commit/c4479db87a56e4e815478465239616a1210fadc0))

## [3.0.0](https://github.com/firestartr-pro/firestartr/compare/v2.11.1...v3.0.0) (2026-10-02)


### ⚠ BREAKING CHANGES

* new OSS version ([#9](https://github.com/firestartr-pro/firestartr/issues/9))

### Features

* new OSS version ([#9](https://github.com/firestartr-pro/firestartr/issues/9)) ([61a50f9](https://github.com/firestartr-pro/firestartr/commit/61a50f981458e28aa5d4acfc9a009dbe67ddcbe1))
