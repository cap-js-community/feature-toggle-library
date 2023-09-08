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
const { FeatureToggles } = require("@cap-js-community/feature-toggle-library");
const instance = new FeatureToggles({ uniqueName: "snowflake" });
```

The library prepares a convenient `singleton` instance of FeatureToggles for out-of-the-box usage, where the Cloud
Foundry _app name_ is used as unique name. This should be sufficient for most use-cases.

```javascript
const { singleton } = require("@cap-js-community/feature-toggle-library");
```

{: .warn }
Be aware that using the singleton instance and changing the app name will invalidate the Redis state and set
back all toggles to their fallback values.

## Configuration

We recommend maintaining the configuration in a _version-tracked_, YAML- or JSON-file, which only changes during
deployments. The configuration is a key-value map describing each individual feature toggle. Here is an example in YAML.

```yaml
/srv/util/logger/logLevel:
  type: string
  fallbackValue: info
  appUrl: \.cfapps\.sap\.hana\.ondemand\.com$
  validations:
    - regex: ^(error|warn|info|verbose|debug)$
```

The semantics of these properties are as follows.

| property      | required | meaning                                                          |
| :------------ | :------- | :--------------------------------------------------------------- |
| type          | true     | one of the allowed types `boolean`, `number`, `string`           |
| fallbackValue | true     | see below                                                        |
| active        |          | if this is `false`, the corresponding feature toggle is inactive |
| appUrl        |          | see below                                                        |
| validations   |          | see below                                                        |

_fallbackValue_<br>
This value gets set initially when the feature toggle is introduced, and it is also used as a fallback when
communication with Redis is interrupted during startup.

_appUrl_<br>
Regular expression for activating a feature toggle _only_ if at least one of its Cloud Foundry application's urls match.
When the library is not running `CF_REDIS` [integration mode](#integration-mode), this check is disabled. Here are some examples:

- for CANARY landscape `\.cfapps\.sap\.hana\.ondemand\.com$`,
- for EU10 landscape `\.cfapps\.eu10\.hana\.ondemand\.com$`,
- specific CANARY app `<cf-app-name>\.cfapps\.sap\.hana\.ondemand\.com$`.

_validations_<br>
List of validations that will guard all changes of the associated feature toggle. All validations must pass
successfully for a change to occur.

| property | example                                                    | meaning                    |
| :------- | :--------------------------------------------------------- | :------------------------- |
| scopes   | [tenant, user]                                             | see below                  |
| regex    | ^\d+$                                                      | value must pass regex test |
| module   | { module: $CONFIG_DIR/validations.js, call: myValidation } | see below                  |

_scopes_<br>
Scopes validation is a list of strings, for example `scopes: [tenant, user]`. With this configuration only matching
scopes can be used when changing feature toggle values.

_module_<br>
Module points to a module, where [external validations](#external-validation) are implemented. These external checks
get registered during initialization and will run for every change. You can specify just the module and export the
validation function directly. Alternatively, you specify both the module and a property to call on the module. For the
module path, you can either specify it relative to the project root `module: ./path-from-root/validations.js` or you
can use the location of the configuration file as a relative anchor `module: $CONFIG_DIR/validation.js`.

{: .info }
You can use the type `string` to encode more complex data types, like arrays or objects, but need to take care of the
serialization/deserialization yourself. In these cases, make sure to use [external validation](#external-validation)
so that new values can be deserialized correctly.

{: .warn }
When using _active_ or _appUrl_ to block activation of a feature toggle, then user code accessing the
feature toggle value will always get the fallback value.

## Initialization for CAP Projects

CAP projects, will use the library as a [cds-plugin](https://cap.cloud.sap/docs/node.js/cds-plugins). Their
initialization settings are in `package.json`. For example:

```json
{
  "cds": {
    "featureToggles": {
      "configFile": "./srv/feature/features.yaml"
    }
  }
}
```

In this example, the path `./srv/feature/feature.yaml` points to the previously discussed configuration file. With
these settings in place, the `singleton` instance of the library will be initialized and is ready for usage at and
after the [bootstrap](https://cap.cloud.sap/cap/docs/node.js/cds-server#bootstrap) event.

{: .info }
Using the feature toggles in CAP projects also enables a [REST service]({{ site.baseurl }}/service/), where toggles can
be read and manipulated.

## Initialization for Non-CAP Projects

Other projects will need to use the corresponding filepath, in order to initialize the feature toggles instance in code.

```javascript
const pathlib = require("path");
const {
  singleton: { initializeFeatures },
} = require("@cap-js-community/feature-toggle-library");
const FEATURES_FILEPATH = pathlib.join(__dirname, "featureTogglesConfig.yml");

// ... during application bootstrap
await initializeFeatures({ configFile: FEATURES_FILEPATH });
```

Alternatively, a runtime configuration object is also supported.

```javascript
const {
  singleton: { initializeFeatures },
} = require("@cap-js-community/feature-toggle-library");

// ... during application bootstrap
await initializeFeatures({
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
  singleton: { initializeFeatures },
  readConfigFromFile,
} = require("@cap-js-community/feature-toggle-library");
const FEATURES_FILEPATH = pathlib.join(__dirname, "featureTogglesConfig.yml");

// ... during application bootstrap
const config = await readConfigFromFile(FEATURES_FILEPATH);
// ... manipulate
await initializeFeatures({ config });
```

## Integration Mode

After successful initialization, the library will write one info log of the form:

```
13:40:13.775 | INFO | /FeatureToggles | finished initialization with 2 feature toggles with NO_REDIS
```

It tells you both how many toggles where initialized and the integration mode, that the library detected. Here are all
possible modes:

| mode          | meaning                                                                          |
| :------------ | :------------------------------------------------------------------------------- |
| `NO_REDIS`    | no redis detected, all changes are only in memory and will be lost on restart    |
| `LOCAL_REDIS` | local redis server detected, changes are persisted in that local redis           |
| `CF_REDIS`    | Cloud Foundry redis service binding detected, changes will be persisted normally |

## Environment Variables

The following environment variables can be used to fine-tune the library's behavior:

| variable                     | default                 | meaning                                                                  |
| :--------------------------- | :---------------------- | :----------------------------------------------------------------------- |
| `BTP_FEATURES_UNIQUE_NAME`   | `<cfAppName>`           | override `uniqueName` of singleton (see [Class](#feature-toggles-class)) |
| `BTP_FEATURES_REDIS_KEY`     | `features-<uniqueName>` | override Redis key for central state                                     |
| `BTP_FEATURES_REDIS_CHANNEL` | `features-<uniqueName>` | override Redis channel for synchronization                               |

## User Code

In this section, we will assume that the [initialization](#initialization) has happened and the configuration contained
a feature toggle with the key `/srv/util/logger/logLevel`, similar to the one described [here](#format).

### Querying Feature Value

You can query the current in memory state of any feature toggle:

```javascript
const {
  singleton: { getFeatureValue },
} = require("@cap-js-community/feature-toggle-library");

// ... in some function
const logLevel = getFeatureValue("/srv/util/logger/logLevel");

// ... with runtime scope information
const logLevel = getFeatureValue("/srv/util/logger/logLevel", {
  tenant: cds.context.tenant,
  user: cds.context.user.id,
});
```

{: .warn }
While `getFeatureValue` is synchronous, and could happen on the top-level of a module. The function will throw, if it
is called _before_ `initializeFeatures`, which is asynchronous. So, it's never sensible to have this on
top-level.

### Observing Feature Value Changes

You can register a callback for all updates to a feature toggle:

```javascript
const {
  singleton: { registerFeatureValueChangeHandler },
} = require("@cap-js-community/feature-toggle-library");

registerFeatureValueChangeHandler("/srv/util/logger/logLevel", (newValue, oldValue, scopeMap) => {
  console.log("changing log level from %s to %s (scope %j)", oldValue, newValue, scopeMap);
  updateLogLevel(newValue);
});

// ... or for async APIs
registerFeatureValueChangeHandler("/srv/util/logger/logLevel", async (newValue, oldValue, scopeMap) => {
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
} = require("@cap-js-community/feature-toggle-library");

// optionally pass in a scopeMap, which describes the least specific scope where the change should happen
async function changeIt(newValue, scopeMap) {
  const validationErrors = await changeFeatureValue("/srv/util/logger/logLevel", newValue, scopeMap);
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
Setting a feature value to `null` will delete the associated remote state and effectively reset it to its fallback
value.

### External Validation

The `string`-type feature toggles can theoretically encode very complex data structures, so it's sensible to validate
inputs in-depth before allowing changes to be published and propagated.

```javascript
const {
  singleton: { registerFeatureValueValidation },
} = require("@cap-js-community/feature-toggle-library");

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
