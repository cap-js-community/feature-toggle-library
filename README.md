# BTP Feature Toggles

- maintain feature-toggle states consistently across app instances
- feature toggle changes are pushed from redis to app instance with PUB/SUB
- app scaling is supported and new apps will start with the correct maintained state,
  or fallback values if they could not connect
- concurrent updates of central state will be handled cleanly with retries using redis transactions concept
- usage code can register callbacks for specific updates or query the current in-memory state

## General

- supported javascript types for any feature toggle value are either `string`, `number`, or `boolean`
- you can use string to encode more complex data types, like arrays or objects, but need to take care of the
  serialization/deserialization yourself
- only pre-defined feature keys can be used see [Config](##Config)
- use the feature key follows the rough semantic of `<cf-app>/<module-path>/<feature-purpose>`, so e.g., `server/util/logger/...`
  would be expected to change the main server's behavior in the logging component

## Config

Configuration happens in the file [featureTogglesConfig.json](./featureTogglesConfig.json), which only changes during
deployments.

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
    - for EU10 landscape `"\\.cfapps\\.sap\\.hana\\.ondemand\\.com$"`
    - for DEV space `"dev-afc-backend\\.cfapps\\.sap\\.hana\\.ondemand\\.com$"`
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
