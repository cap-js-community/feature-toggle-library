---
layout: default
title: CAP Example
nav_order: 4
---

<!-- prettier-ignore-start -->
# CAP Service Example
{: .no_toc }
<!-- prettier-ignore-end -->

<!-- prettier-ignore -->
- TOC
{: toc}

While this feature toggle library works completely without CAP, you can use CAP to easily implement a service that
exposes the feature toggles as a rest API.

## Configuration

featureTogglesConfig.yaml

```yaml
---
# info: switch memory statistics on and off
/srv/util/memoryStatistics/active:
  type: boolean
  fallbackValue: false

# info: change memory statistics writing interval (in milliseconds)
/srv/util/memoryStatistics/logInterval:
  type: number
  fallbackValue: 60000
  validation: '^\d+$'

# info: enable new scheduling for all tenants (only for backends which support new scheduling)
/srv/processApp/newScheduling:
  type: boolean
  fallbackValue: false

# info: server shall crash on uncaught exception or unhandled rejection
/srv/bootstrap/crashOnUnhandledException:
  type: boolean
  fallbackValue: true
```

## Configuration Constants

featureTogglesConfig.js

```javascript
const path = require("path");
const FEATURES_FILEPATH = path.join(__dirname, "featureTogglesConfig.yaml");

const FEATURE = Object.freeze({
  MEM_STAT_ACTIVE: "/srv/util/memoryStatistics/active",
  MEM_STAT_LOG_INTERVAL: "/srv/util/memoryStatistics/logInterval",
  PROCESS_NEW_SCHEDULING: "/srv/processApp/newScheduling",
  BOOTSTRAP_CRASH_ON_UNHANDLED: "/srv/bootstrap/crashOnUnhandledException",
});

module.exports = {
  FEATURES_FILEPATH,
  FEATURE,
};
```

## Service Model

service.cds

```
@protocol: 'rest'
@impl: './service.js'
@(requires: ['system-user'])
service FeatureService {
  type FeatureConfigs {};
  type FeatureValues {};

  function config () returns FeatureConfigs;
  function state () returns FeatureValues;
  action redisRead () returns FeatureValues;
  action redisUpdate (newValues: FeatureValues); // NOTE: expects an object as input
}
```

## Service Implementation

service.js

```javascript
const {
  singleton: {
    initializeFeatureValues,
    getFeatureConfigs,
    getFeatureValues,
    refreshFeatureValues,
    changeFeatureValues,
  },
} = require("@sap/btp-feature-toggles");
const { FEATURES_FILEPATH } = require("./featureTogglesConfig");
const { Logger } = require("../../util/logger");
const { formatText } = require("../../util/i18n");

const COMPONENT_NAME = "/Feature/Service";
const VALIDATION_ERROR_HTTP_CODE = 422;

const moduleLogger = Logger(COMPONENT_NAME);

/**
 * Read all feature configs.
 */
const configHandler = async (context) => {
  const result = getFeatureConfigs();
  return context.reply(result);
};

/**
 * Read all feature values.
 */
const stateHandler = async (context) => {
  const result = getFeatureValues();
  return context.reply(result);
};

/**
 * Refresh feature values from redis and then read all.
 */
const redisReadHandler = async (context) => {
  try {
    await refreshFeatureValues();
    const result = getFeatureValues();
    context.reply(result);
  } catch (err) {
    Logger(context).error(err);
    context.reject(err);
  }
};

/**
 * Add, remove, or change some or all feature values. The change is done by mixing in new values to the current state
 * and value = null means resetting the respective key to its fallback value. Validation ensures that only values of
 * type string, number, and boolean are kept.
 *
 * Example:
 *   old_state = { a: "a", b: 2, c: true }, input = { a: null, b: "b", d: 1 }
 *   => new_state = { a: "initial", b: "b", c: true, d: 1 }
 *
 * NOTE this will answer 204 if the input was accepted and sent to redis, otherwise 422 with a list of validation
 * errors.
 * @private
 */
const redisUpdateHandler = async (context) => {
  const logger = Logger(context, COMPONENT_NAME);
  try {
    logger.info("feature toggle change triggered with %O", context.data);
    const validationErrors = await changeFeatureValues(context.data);
    if (Array.isArray(validationErrors) && validationErrors.length > 0) {
      for (const { key: target, errorMessage, errorMessageValues } of validationErrors) {
        const errorMessageWithValues = formatText(errorMessage, errorMessageValues);
        context.error(VALIDATION_ERROR_HTTP_CODE, errorMessageWithValues, [], target);
      }
    }
    context.reply();
  } catch (err) {
    logger.error(err);
    context.reject(err);
  }
};

module.exports = async (srv) => {
  // NOTE: this happens during cap's service loading, if you need the toggles before that add them earlier in your
  // bootstraping
  await initializeFeatureValues({
    configFile: FEATURES_FILEPATH,
  });

  const { config, state, redisRead, redisUpdate } = srv.operations("FeatureService");
  srv.on(config, configHandler);
  srv.on(state, stateHandler);
  srv.on(redisRead, redisReadHandler);
  srv.on(redisUpdate, redisUpdateHandler);
};
```
