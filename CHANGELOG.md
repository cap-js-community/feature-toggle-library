# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## v1.1.0 - 2023-12-01

⚠️ User action required! This release will be more disruptive than usual. We re-thought that main `require` API and
made it much leaner. These changes should have happened in 1.0, sorry for the inconvenience.

```javascript
// before
const {
  singleton: { getFeatureValue },
} = require("@cap-js-community/feature-toggle-library");

function someFunc() {
  getFeatureValue(key);
}

// after
const toggles = require("@cap-js-community/feature-toggle-library");

function someFunc() {
  toggles.getFeatureValue(key);
}
```

For details see
[https://cap-js-community.github.io/feature-toggle-library/usage/](https://cap-js-community.github.io/feature-toggle-library/usage/)

### Changed

- the library now exports _only_ the singleton instance (fixes #39).
- cds-plugin: the request header features are only respected in development environments (fixes #41).

## v1.0.0 - 2023-11-27

We are releasing 1.0, after 2 years of continuous usage, testing, and small improvements.

### Removed

- restrict to node v18+

### Added

- act as
  [Feature Vector Provider](https://cap.cloud.sap/docs/guides/extensibility/feature-toggles#feature-vector-providers)
  when used as a CDS-plugin.
- allow graceful shutdown by closing redis clients on cds shutdown event (fixes #34).

## v0.7.2 - 2023-10-18

### Added

- support for redis cluster configurations.
- enable setting maximal log level through env variable `BTP_FEATURES_LOG_LEVEL`. this can be used to silence the
  library during tests.

### Changed

- implement new CDS-plugin API, where plugins export a promise instead of an activate property and stay compatible for
  older cds versions.

## v0.7.1 - 2023-09-13

### Fixed

- CDS-plugin integration now works for projects that run `cds build --production` and only use the resulting
  `csn.json` at runtime.

## v0.7.0 - 2023-09-08

### Added

- new harmonized validation configuration for scope and regex checks, as well as external validation with user
  provided modules.

- new (optional) [CDS-plugin](https://cap.cloud.sap/docs/node.js/cds-plugins) integration. for details, see the new
  [plugin and service](https://cap-js-community.github.io/feature-toggle-library/service/) documentation.

- new logger implementation which replaces
  [cf-nodejs-logging-support](https://www.npmjs.com/package/cf-nodejs-logging-support) dependency. it has better cds
  integration (if present). for example, it will log
  [correlation ids](https://cap.cloud.sap/docs/node.js/cds-log#node-observability-correlation) that are present in cds
  context via [async local storage](https://nodejs.org/api/async_context.html#class-asynclocalstorage).

### Changed

- `allowedScopes: [xxx]` configuration will now be ignored and needs to be replaced with
  `validations: [{ scopes: [xxx] }]`.

- `validation: yyy` configuration will now be ignored and needs to be replaced with
  `validations: [{ regex: yyy }]`.

### Fixed

- re-work pipelines to separate main branch and pr-voter status

## v0.6.9 - 2023-07-18

### Added

- example http request file for [example-cap-server](./example-cap-server)

### Fixed

- better documentation regarding scoping and redis hash map persistence

- more resilient handling of bad input for scopeMaps in all external APIs

## v0.6.8 - 2023-06-27

### Added

- first public release on npmjs

## v0.6.7 - 2023-06-20

### Added

- added `allowedScopes` configuration, which validates that correct scope names are used for updates

### Fixed

- separate `rootValue` from other `scopedValues` in `getFeatureInfo` and `getFeaturesInfos` APIs

## v0.6.6 - 2023-06-19

### Added

- added `example-cap-server` code, that acts both as an example integration code into existing cap projects and as a
  starting point for manual testing

### Fixed

- first iteration towards updating documentation

## v0.6.5 - 2023-06-13

### Fixed

- fix bug where scoped values were ignored if they are falsy

## v0.6.4 - 2023-06-11

### Added

- simple migration for old sting-type state to hash-type persistence state

## v0.6.2 - 2023-06-10

### Fixed

- fix redis transaction re-writes

## v0.6.1 - 2023-06-07

### Removed

- remove API to read feature config and metadata `getFeatureConfig` and `getFeatureConfigs`.
  use `getFeatureInfo` and `getFeaturesInfos` instead

### Added

- new option to add _scope restrictions_ when reading or setting feature toggles

- separate persistence on redis using `HGET`, `HSET`, so that individual toggle changes don't have to touch the state
  of all feature toggles. effectively we change the redis type for the persistence key from `string` to `hash`.

- new API `getFeatureInfo` and `getFeaturesInfos` to get all config and state information in one call

### Fixed

- rewrite to improve config handling internally

- fix some problems with the logger in combination with verror

## v0.5.18 - 2023-04-25

### Removed

- restrict to node v16+

### Added

- new interface to get `main` and `subscriber` client in redis wrapper

### Fixed

- better coding and interface for `LazyCache` and `ExpiringLazyCache`

- more and improved jsdocs

- allow options to be passed in redis wrapper `set` implementation.
  see [SET](https://redis.io/commands/set/) for details.

## v0.5.17 - 2022-12-13

### Fixed

- make logging for warn level work properly

## v0.5.16 - 2022-12-08

### Fixed

- re-work logging approach so structured logging will capture [VError](https://www.npmjs.com/package/verror) info

## v0.5.15 - 2022-06-03

### Fixed

- update feature value is now exclusive under high concurrency
  (semaphore implementation by [oklemenz2](https://github.com/oklemenz2))

- prettier and documentation work better together

## v0.5.14 - 2022-03-29

### Added

- users can rely on _always_ getting fallback value

## v0.5.13 - 2022-03-18

### Added

- local integration tests

- write own env implementation replacing [@sap/xsenv](https://www.npmjs.com/package/@sap/xsenv) dependency

## v0.5.12 - 2022-03-09

### Fixed

- more fixes related to error event handling in local case after redis library v4 migration

## v0.5.11 - 2022-03-09

### Removed

- restrict to node v12+

### Fixed

- fix `mainClient` and `subscriberClient` reference handling in error case

## v0.5.10 - 2022-03-03

### Fixed

- migrate [redis](https://www.npmjs.com/package/redis) dependency to v4

## v0.5.8 - 2022-02-03

### Added

- allow to set singleton `uniqueName` via env variable `BTP_FEATURES_UNIQUE_NAME`

## v0.5.7 - 2022-01-13

### Fixed

- fix `readConfigFromFile` for yaml case

## v0.5.6 - 2021-12-22

### Removed

- config property `enabled` is discontinued, use `active` instead

### Added

- new config property: `active`. if active is set to false, no changes of the feature toggle is allowed, but old value
  stays in place

- new API to read feature config and metadata `getFeatureConfig` and `getFeatureConfigs`

### Fixed

- change interface name `readConfigFromFilepath` to `readConfigFromFile`

- change signature for `FeatureValueChangeHandler` to `handler(newValue, oldValue)`

## v0.5.5 - 2021-12-15

### Fixed

- change external validators interface to allow reporting multiple errors

## v0.5.4 - 2021-12-10

### Fixed

- change validator return interface to ValidationErrors for consistency

## v0.5.3 - 2021-12-10

### Fixed

- make singleton more IDE friendly and ensure correctness with test

- switch to artifactory registry

## v0.5.2 - 2021-12-06

### Added

- feature: external validation

### Fixed

- readme update

- handler name fallback for anonymous functions

- inputValidation is now async to account for potentially async external validators

## v0.5.0 - 2021-11-11

### Added

- Initial public release
