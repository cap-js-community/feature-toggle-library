# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

<!-- order is REMOVED, CHANGED, ADDED, FIXED -->

## v1.3.2 - tbd

### Removed

- restrict to at least node v20.

### Added

- enable voters for node v24.

## v1.3.1 - 2025-09-15

### Changed

- core: compatability changes for cds v9.

### Added

- more testing for usage with cds.

## v1.3.0 - 2025-05-27

⚠️ This release is potentially disruptive. Initialize will throw for previously ignored problems with configuration
correctness. The coalesce logic for using multiple configuration sources has changed. For details see
[Layered Configuration](https://cap-js-community.github.io/feature-toggle-library/concepts/#layered-configuration).

### Changed

- core: initialization throws if mandatory configuration `fallbackValue` is `undefined` (missing) or `null` (always
  invalid).

- core: initialization throws if mandatory configuration `type` is not in `["boolean", "number", "string"]` (invalid).

- core: initialization throws if its invoked more than once. previously subsequent calls and their options were
  ignored.

- core: configuration reading and coalescing has changed:
  - up to `v1.2.5`, the order was `runtime`, `files`, `auto`, where the _first occurrence_ is used for each toggle
  - from `v1.3.0`, the order is `auto`, `files`, `runtime`, where the _last occurrence_ is used for each toggle
  - this enables overriding the configuration based on environmental factors, by mixing in dedicated config files

## v1.2.5 - 2025-02-20

### Fixed

- core: if a `./default-env.json` file was present and `NODE_ENV !== "production"`, we had assumed that cf env variables
  `VCAP_APPLCATION` and `VCAP_SERVICES` are always present in the file. now this is more resilient.

- core: [regression] initialize timing was noticeably slower, because the initial connection check was running with the
  default reconnect strategy that takes 2000ms. now the reconnect strategy is disabled for the initial connection check.

## v1.2.4 - 2025-02-19

### Changed

- cds-plugin: change default service access role to `internal-user` (fixes #90).
- redis: changed dependency from [redis](https://www.npmjs.com/package/redis) to [@redis/client](https://www.npmjs.com/package/@redis/client).

### Added

- core: [undocumented] plugin-config/initialize support multiple configuration files.
- redis: [undocumented] cds-config/initialize take redis credentials and client options for fine-tuning or as an
  alternative to VCAP_SERVICES (brought up by #92).

  the cds-config approach is consistent with the redis integration of other cap-js-community projects, see
  [event-queue](https://github.com/cap-js-community/event-queue/),
  [websocket](https://github.com/cap-js-community/websocket/).

## v1.2.3 - 2025-02-05

### Added

- cds-plugin: added explicit implementation for `FeatureService`.
- enable node v22 voters.

### Fixed

- cds-plugin: allow feature toggles to initialize with no configured toggles.
- use proper cds syntax to get service operations (by [johannes-vogel](https://github.com/johannes-vogel)).

## v1.2.2 - 2024-11-14

### Changed

- the initialization log of the library will now show the unique name used. this name is used to derive both the redis
  storage key and pub/sub channel.

### Fixed

- internal naming cleanup and consistency work.

## v1.2.1 - 2024-09-30

### Changed

- cds-plugin: service endpoint `/rest/feature/redisRead` will return server in-memory changes in NO_REDIS mode in
  order to be consistent with `/rest/feature/redisUpdate`.

### Added

- cds-plugin: added `cds.test()` basic request/response tests for service.

### Fixed

- cds-plugin: service endpoint `/rest/feature/redisRead` works without http errors in NO_REDIS mode.

## v1.2.0 - 2024-09-25

⚠️ This release contains two minor breaking changes.

### Changed

- The main class of the library is no longer explicitly exported. You can access it implicitly as constructor of the
  exported class instance.

  ```javascript
  // before
  const { FeatureToggles } = require("@cap-js-community/feature-toggle-library");
  const myToggles = new FeatureToggles({ uniqueName: "snowflake" });

  // after
  const toggles = require("@cap-js-community/feature-toggle-library");
  const FeatureToggles = toggles.constructor;
  const myToggles = new FeatureToggles({ uniqueName: "snowflake" });
  ```

- cds-plugin: rewrote `/rest/feature/redisRead` endpoint to show all Redis maintained toggle values, including those of
  toggles that are _not configured_. The endpoint no longer refreshes the server-local toggle state. Consequently, it
  will work with `read` access privileges, since it can no longer modify the server-local state (fixes #69).

### Added

- added `remoteOnly` option for `/rest/feature/redisUpdate` endpoint and the `changeFeatureValue()` API. With this
  option, you can clean up Redis maintained values that are no longer configured (fixes #69).
- cds-plugin: better detection of serve mode following changes in [@sap/cds](https://www.npmjs.com/package/@sap/cds)
  v8.2.3

### Fixed

- multiple, even concurrent, calls of `initializeFeatures()` will only ever trigger one execution of the underlying
  initialization.

## v1.1.7 - 2024-09-17

### Fixed

- setting a root value with the option `{ clearSubScopes: true }` only deleted the root and scoped values, but did
  not set the new root value.

## v1.1.6 - 2024-07-23

### Fixed

- cds-plugin: fix `uniqueName` configuration processing
- more consistent scope preference order when 2 out of 4 scopes are set

## v1.1.5 - 2024-06-06

### Changed

- fallback value `null` is no longer allowed (fixes #62).
- change handlers no longer receive `null` as new values, they get the actual new value for the relevant scope instead
  (fixes #64).

### Fixed

- cds-plugin: unify and fix syntax of `context.error` and `context.reject` for cds service.
- change processing is more resilient. for redis message with multiple changes, if one change fails, then subsequent
  changes will still be processed.

## v1.1.4 - 2024-04-08

### Added

- docs: basic documentation for newest cds-plugin features.
- cds-plugin: better access control (fixes #57).

### Fixed

- redis: better integration mode, will not log a connection error if redis is not present.

## v1.1.2 - 2024-03-21

### Added

- cds-plugin: fts feature toggles are detected and configured automatically (fixes #50).
- cds-plugin: allow custom scope map callback for fts feature toggles (fixes #51).
- cds-plugin: can configure unique name, i.e. which apps store the same toggles in redis, as part of cds configuration.

### Fixed

- cds-plugin: feature toggles will not initialize during cds build.
- redis: proper usage of redis-client built-in reconnect capabilities.

## v1.1.1 - 2023-12-05

### Changed

- cds-service: always log update contents for traceability and improved logging for redis read and update errors.
- docs: add getting started section (fixes #43).

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
  when used as a CDS-Plugin.
- allow graceful shutdown by closing redis clients on cds shutdown event (fixes #34).

## v0.7.2 - 2023-10-18

### Added

- support for redis cluster configurations.
- enable setting maximal log level through env variable `BTP_FEATURES_LOG_LEVEL`. this can be used to silence the
  library during tests.

### Changed

- implement new CDS-Plugin API, where plugins export a promise instead of an activate property and stay compatible for
  older cds versions.

## v0.7.1 - 2023-09-13

### Fixed

- CDS-Plugin integration now works for projects that run `cds build --production` and only use the resulting
  `csn.json` at runtime.

## v0.7.0 - 2023-09-08

### Added

- new harmonized validation configuration for scope and regex checks, as well as external validation with user
  provided modules.

- new (optional) [CDS-Plugin](https://cap.cloud.sap/docs/node.js/cds-plugins) integration. for details, see the new
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
