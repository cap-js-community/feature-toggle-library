---
layout: default
title: Usage
nav_order: 2
---

<!-- prettier-ignore-start -->
# Usage
{: .no_toc }
<!-- prettier-ignore-end -->

<!-- prettier-ignore -->
- TOC
{: toc}

## Feature Toggles Class

The main class of the library is `FeatureToggles`, all synchronization for a given configuration happens within an
instance of this class. Constructing an instance requires a _unique name_, so that multiple instances communicating with
Redis don't access the same data, unless this is intended. Whenever two or more instances use the same unique name, they
must be _initialized_ with the same configuration.

```javascript
const { FeatureToggles } = require("@sap/btp-feature-toggles");
const instance = new FeatureToggles({ uniqueName: "snowflake" });
```

The library prepares a convenient `singleton` instance of FeatureToggles for out-of-the-box usage, where the Cloud
Foundry _app name_ is used as unique name. This should be sufficient for most use-cases.

```javascript
const { singleton } = require("@sap/btp-feature-toggles");
```

{: .warn }
Be aware that using the singleton instance and changing the app name will invalidate the Redis state and set
back all toggles to their fallback.

## Configuration

### Initialization

We recommend maintaining the configuration in a _version-tracked_, YAML- or JSON-file, which only changes during
deployments. You will need to use the corresponding filepath, in order to initialize the feature toggles instance.

```javascript
const pathlib = require("path");
const {
  singleton: { initializeFeatureValues },
} = require("@sap/btp-feature-toggles");
const FEATURES_FILEPATH = pathlib.join(__dirname, "featureTogglesConfig.yml");

// ... during application bootstrap
await initializeFeatureValues({ configFile: FEATURES_FILEPATH });
```

Alternatively, a runtime configuration object is also supported.

```javascript
const {
  singleton: { initializeFeatureValues },
} = require("@sap/btp-feature-toggles");

// ... during application bootstrap
await initializeFeatureValues({
  config: {
    runNewCode: {
      type: "boolean",
      fallbackValue: false,
    },
    maxConsumers: {
      type: "number",
      fallbackValue: 100,
    },
  },
});
```

In rare cases, it can make sense to read the configuration from file and manipulate it in code before passing it to the
feature toggles.

```javascript
const pathlib = require("path");
const {
  singleton: { initializeFeatureValues },
  readConfigFromFile,
} = require("@sap/btp-feature-toggles");
const FEATURES_FILEPATH = pathlib.join(__dirname, "featureTogglesConfig.yml");

// ... during application bootstrap
const config = await readConfigFromFile(FEATURES_FILEPATH);
// ... manipulate
await initializeFeatureValues({ config });
```

### Format

The configuration is a key-value map describing each individual feature toggle. Here is an example in YAML.

```yaml
/srv/util/logger/logLevel:
  type: string
  fallbackValue: info
  appUrl: \.cfapps\.sap\.hana\.ondemand\.com$
  validation: ^(?:error|warn|info|verbose|debug)$
```

The semantics of these properties are as follows.

| property      | required | meaning                                                          |
| :------------ | :------- | :--------------------------------------------------------------- |
| active        |          | if this is `false`, the corresponding feature toggle is inactive |
| type          | true     | one of the allowed types `boolean`, `number`, `string`           |
| fallbackValue | true     | see below                                                        |
| appUrl        |          | see below                                                        |
| validation    |          | regex for input validation                                       |

_fallbackValue_<br>
This value gets set initially when the featue toggle is introduced, and it is also used as a fallback when
communication with Redis is blocked during startup.

_appUrl_<br>
Regex for activating feature toggle _only_ if the cf app's url matches

- for CANARY landscape `\.cfapps\.sap\.hana\.ondemand\.com$`
- for EU10 landscape `\.cfapps\.eu10\.hana\.ondemand\.com$`
- specific CANARY app `<cf-app-name>\.cfapps\.sap\.hana\.ondemand\.com$`

{: .info }
You can use the type `string` to encode more complex data types, like arrays or objects, but need to take care of the
serialization/deserialization yourself. In these cases, make sure to use [external validation](#external-validation)
so that new values can be deserialized correctly.

{: .warn }
When using active or appUrl to block activation of a feature toggle, then user-code accessing the
feature toggle value will _always_ get the fallback value.

## Environment Variables

The following environment variables can be used to fine-tune the library's behavior:

| variable                   | default                 | meaning                                                                  |
| :------------------------- | :---------------------- | :----------------------------------------------------------------------- |
| `BTP_FEATURES_UNIQUE_NAME` | `<cfAppName>`           | override `uniqueName` of singleton (see [Class](#feature-toggles-class)) |
| `BTP_FEATURES_KEY`         | `features-<uniqueName>` | override Redis key for central state                                     |
| `BTP_FEATURES_CHANNEL`     | `features-<uniqueName>` | override Redis channel for synchronization                               |

## User-Code

In this section, we will assume that the [initialization](#initialization) has happened and the configuration contained
a feature toggle with the key `/srv/util/logger/logLevel`, similar to the one described [here](#format).

### Querying Feature Value

You can query the current in memory state of any feature toggle:

```javascript
const {
  singleton: { getFeatureValue },
} = require("@sap/btp-feature-toggles");

// ... in some function
const logLevel = getFeatureValue("/srv/util/logger/logLevel");
```

{: .warn }
While `getFeatureValue` is synchronous, and could happen on the top-level of a module. The function will throw, if it
is called _before_ `initializeFeatureValues`, which is asynchronous. So, it's never sensible to have this on
top-level.

You can also query the values of all feature toggles at once.

```javascript
const {
  singleton: { getFeatureValues },
} = require("@sap/btp-feature-toggles");

// ... in some function
const allValues = getFeatureValues();
const logLevel = allValues["/srv/util/logger/logLevel"];
```

The API `getFeatureValues` returns a clone of the internal state, so the object returned here can be modified without
side effects.

### Observing Feature Value Changes

You can register for all updates of a specific feature toggle:

```javascript
const {
  singleton: { registerFeatureValueChangeHandler },
} = require("@sap/btp-feature-toggles");

registerFeatureValueChangeHandler("/srv/util/logger/logLevel", (newValue, oldValue) => {
  console.log("changing log level from %s to %s", oldValue, newValue);
  updateLogLevel(newValue);
});

// ... or for async APIs
registerFeatureValueChangeHandler("/srv/util/logger/logLevel", async (newValue) => {
  await updateLogLevel(newValue);
});
```

{: .info }
Registering any callback will not require that the feature toggles are initialized, so this can happen on top-level.

### Updating Feature Value

Finally, updating the feature toggle value:

```javascript
const {
  singleton: { changeFeatureValue },
} = require("@sap/btp-feature-toggles");

async function changeIt(newValue) {
  const validationErrors = await changeFeatureValue("/srv/util/logger/logLevel", newValue);
  if (Array.isArray(validationErrors) && validationErrors.length > 0) {
    for (const { errorMessage, errorMessageValues } of validationErrors) {
      // show errors to the user, the change did not happen
    }
  }
}
```

The change API `changeFeatureValue` will return when the change is published to Redis, so there may be a slight
processing delay until the change is picked up by all subscribers.

{: .info }
Setting a value to `null` will return the associated toggle to its fallback value.

### External Validation

The `string`-type feature toggles can theoretically encode very complex data structures, so it's sensible to validate
inputs in-depth before allowing changes to be published and propagated.

```javascript
const {
  singleton: { registerFeatureValueValidation },
} = require("@sap/btp-feature-toggles");

registerFeatureValueValidation("/srv/util/logger/logLevel", (newValue) => {
  if (isBad(newValue)) {
    return { errorMessage: "got bad value" };
  }
  if (isWorse(newValue)) {
    return { errorMessage: 'got bad value with parameter "{0}"', errorMessageValues: [paramFromValue(newValue)] };
  }
});
```

{: .info }
Simple validation rules that can be expressed as a regular expression should use the associated
validation [configuration](#format) instead.
