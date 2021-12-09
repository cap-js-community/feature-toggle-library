# BTP Feature Toggles

- maintain feature-toggle states consistently across app instances
- feature toggle changes are pushed from redis to app instance with PUB/SUB
- app scaling is supported and new apps will start with the correct maintained state,
  or fallback values if they could not connect
- concurrent updates of central state will be handled cleanly with retries using redis' transaction concept
- usage code can register callbacks for specific updates or query the current in-memory state
- feature toggles keep state changes until restart on single-node machines (locally)

## General

- supported javascript types for any feature toggle value are either `string`, `number`, or `boolean`
- you can use string to encode more complex data types, like arrays or objects, but need to take care of the
  serialization/deserialization yourself
- only pre-defined feature keys can be used see [Config](#config)
- current implementation follows a [Single-Key-Approach](#single-key-approach)
- (optional) feature key naming follows the rough semantic of `/<module-path>/<feature-purpose>`,
  so e.g., `/srv/util/logger/level`
  would be expected to change the logging module's level setting

## Single key approach

- technically all feature toggles (usually for one cf-app) are kept in a single key on redis
- this makes the discovery of which toggles are maintained trivial
- it also makes pub-sub-change-discovery/synchronization/lock-resolution and so on easy
- on the flipside, the sync speed will degrade with the cumulative size of _all_ toggle states,
  so if you have lots of toggles with long state strings, it will be slower than necessary

## Config

Configuration happens in a fixed file (JSON or YAML format), which only changes during deployments. This file should be
committed, and you need to use the corresponding filepath, when the toggles get initialized. A runtime configuration
object is also supported.

This config describes all valid feature toggle keys:

```
{
  "/server/util/logger/logLevel": {
    "enabled": true,
    "appUrl": "\\.cfapps\\.sap\\.hana\\.ondemand\\.com$",
    "info": "change global log level to one of the allowed error, warn, info, verbose, debug",
    "fallbackValue": "info",
    "type": "string",
    "validation": "^(?:error|warn|info|verbose|debug)$"
  }
}
```

The semantics of the properties are:

- enabled: if this is false, the corresponding feature toggle gets ignored
- appUrl: optional regex for activating _only_ for matching appUrls
  - for CANARY landscape `"\\.cfapps\\.sap\\.hana\\.ondemand\\.com$"`
  - for EU10 landscape `"\\.cfapps\\.eu10\\.hana\\.ondemand\\.com$"`
  - specific CANARY app `"<cf-app-name>\\.cfapps\\.sap\\.hana\\.ondemand\\.com$"`
- info: a terse informational text for the developers using the toggle
- fallbackValue: this value gets set initially when the featue toggle is introduced, and it is also used as a fallback
  when communication with redis is blocked during startup
- type: one of the three allowed types `boolean`, `number`, `string`
- validation: optional regex for further input validation

## Usage

- Use `getFeatureValue` to this query the server memory, which is kept up-to-date with the lastest changes from redis.
- Alternatively, register a handler with `registerFeatureValueChangeHandler` that gets called every time new changes
  come in through redis.
- Push new changes to redis with `changeFeatureValue`.
