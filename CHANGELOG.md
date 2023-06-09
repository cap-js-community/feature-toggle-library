# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

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
