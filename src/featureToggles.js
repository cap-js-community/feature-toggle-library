/**
 * simple feature toggle system.
 *
 * - validates that feature value types are string, number, or boolean
 * - validates that only pre-defined feature keys are used
 * - no nested features (though with stringify you could sort of get that)
 *
 * technical approach:
 * - have a constant redis key "features" where the feature toggle state is expected
 * - on init this key is read
 *   - if it's not empty: take the value and save it in memory for runtime queries
 *   - if it's empty: do a (optimistcally locked) write with the fallback values
 * - to synchronize changes we use redis pub/sub system and a dedicated "features" channel
 *   - when feature changes are triggered the "features" key is locked and updated and
 *   - a "refresh" message is published to all instances
 *
 * important usage functions:
 * @see getFeatureValue
 * @see changeFeatureValue
 * @see registerFeatureValueChangeHandler
 *
 */

// TODO redis messageHandlers and featureValuesChangeHandlers could probably be abstracted into reuse code

// TODO migrate tests

"use strict";

const path = require("path");
const VError = require("verror");
const {
  registerMessageHandler,
  getObject: redisGetObject,
  watchedGetSetObject: redisWatchedGetSetObject,
  publishMessage,
} = require("./redisWrapper");
const { Logger } = require("./logger");
const { isNull } = require("./helper");
const { LazyCache } = require("./lazyCaches");
const { isOnCF, cfApp } = require("./env");

const FEATURES_CHANNEL = process.env.BTP_FEATURES_CHANNEL || "features";
const FEATURES_KEY = process.env.BTP_FEATURES_KEY || "features";
const REFRESH_MESSAGE = "refresh";
const DEFAULT_CONFIG_FILEPATH = path.join(process.cwd(), "featureTogglesConfig.json");
const FEATURE_VALID_TYPES = ["string", "number", "boolean"];

const COMPONENT_NAME = "/FeatureToggles";
const VERROR_CLUSTER_NAME = "FeatureTogglesError";

const logger = Logger(COMPONENT_NAME);

let isInitialized = false;
let featureValues = {};
let featureValuesChangeHandlers = {};
let config = {};
let configKeys = [];
let configCache = new LazyCache();

const _setConfigFromBase = (configBase) => {
  if (configBase) {
    const cfAppData = cfApp();
    config = Object.fromEntries(
      Object.entries(configBase).filter(([, value]) => {
        if (!value.enabled) {
          return false;
        }
        if (value.appUrl) {
          const appUrlRegex = new RegExp(value.appUrl);
          if (
            Array.isArray(cfAppData.uris) &&
            !cfAppData.uris.reduce((current, next) => current && appUrlRegex.test(next), true)
          ) {
            return false;
          }
        }
        return true;
      })
    );
    configKeys = Object.keys(config);
  }
  return config;
};

const _reset = () => {
  isInitialized = false;
  featureValues = {};
  featureValuesChangeHandlers = {};
  config = {};
  configKeys = [];
  configCache = new LazyCache();
};
const _isInitialized = () => isInitialized;
const _getFeatureValues = () => featureValues;
const _setFeatureValues = (input) => (featureValues = input);
const _getFeatureValuesChangeHandlers = () => featureValuesChangeHandlers;
const _setFeatureValuesChangeHandlers = (input) => (featureValuesChangeHandlers = input);
const _hasChangeHandlers = (key) => Object.prototype.hasOwnProperty.call(featureValuesChangeHandlers, key);

const isValidFeatureKey = (key) => typeof key === "string" && configKeys.includes(key);
const isValidFeatureValueType = (value) => value === null || FEATURE_VALID_TYPES.includes(typeof value);

const _validateInputEntry = (key, value) => {
  if (!isInitialized) {
    return { errorMessage: "not initialized" };
  }
  if (!isValidFeatureKey(key)) {
    return { key, errorMessage: 'key "{0}" is not valid', errorMessageValues: [key] };
  }
  // NOTE: value === null is our way of encoding key resetting changes, so it is always allowed
  if (value !== null) {
    const valueType = typeof value;
    if (!isValidFeatureValueType(value)) {
      return {
        key,
        errorMessage: 'value "{0}" has invalid type {1}, must be in {2}',
        errorMessageValues: [value, valueType, FEATURE_VALID_TYPES],
      };
    }

    const { type: targetType, validation } = config[key];
    if (targetType && valueType !== targetType) {
      return {
        key,
        errorMessage: 'value "{0}" has invalid type {1}, must be {2}',
        errorMessageValues: [value, valueType, targetType],
      };
    }

    const validationRegExp = configCache.getSetCb(
      [key, "validationRegExp"],
      ({ validation }) => (validation ? new RegExp(validation) : null),
      config[key]
    );
    if (validationRegExp && !validationRegExp.test(value)) {
      return {
        key,
        errorMessage: 'value "{0}" does not match validation regular expression {1}',
        errorMessageValues: [value, validation],
      };
    }
  }
};

/**
 * Will return a pair [result, validationErrors], where validationErrors is a list of { key, errorMessage } objects
 * and result are all inputs that passed validated or null for illegal/empty input.
 *
 * @param input
 * @returns [{null|*}, Array<ValidationError>]
 */
const validateInput = (input) => {
  const validationErrors = [];
  if (isNull(input) || typeof input !== "object") {
    return [null, validationErrors];
  }
  const resultEntries = [];
  for (const [key, value] of Object.entries(input)) {
    const validationError = _validateInputEntry(key, value);
    if (validationError) {
      validationErrors.push(validationError);
    } else {
      resultEntries.push([key, value]);
    }
  }
  if (resultEntries.length === 0) {
    return [null, validationErrors];
  }
  return [Object.fromEntries(resultEntries), validationErrors];
};

const _messageHandler = async (input) => {
  try {
    if (input !== REFRESH_MESSAGE) {
      return;
    }
    await refreshFeatureValues();
  } catch (err) {
    logger.error(
      new VError(
        {
          name: VERROR_CLUSTER_NAME,
          cause: err,
          info: {
            channel: FEATURES_CHANNEL,
          },
        },
        "error during message handling"
      )
    );
  }
};

/**
 * Call this with
 * - your configuration object or
 * - local filepath to a json file with your configuration object (recommended)
 * to initialize the feature toggles. For example during service loading.
 *
 * For syntax and details regarding the configuration object refer to README.md.
 */
const initializeFeatureToggles = async ({ config: configInput, configFilepath = DEFAULT_CONFIG_FILEPATH } = {}) => {
  if (isInitialized) {
    return;
  }

  let cause;
  try {
    const configBase = configInput ? configInput : require(configFilepath);
    config = _setConfigFromBase(configBase);
    isInitialized = true;
  } catch (err) {
    cause = err;
  }
  if (!isInitialized) {
    logger.error(
      new VError(
        {
          name: VERROR_CLUSTER_NAME,
          info: { configInput: JSON.stringify(configInput), configFilepath },
          ...(cause && { cause }),
        },
        "initialization aborted, could not resolve configuration"
      )
    );
    return;
  }

  const featureValuesFallback = Object.fromEntries(
    Object.entries(config).map(([key, value]) => [key, value.fallbackValue])
  );
  const [validatedFallback, validationErrors] = validateInput(featureValuesFallback);
  if (Array.isArray(validationErrors) && validationErrors.length > 0) {
    logger.error(
      new VError(
        {
          name: VERROR_CLUSTER_NAME,
          info: { validationErrors: JSON.stringify(validationErrors) },
        },
        "found invalid fallback values during initialization"
      )
    );
  }
  try {
    featureValues = await redisWatchedGetSetObject(FEATURES_KEY, (oldValue) => {
      const [validatedOldValues, validationErrors] = validateInput(oldValue);
      if (Array.isArray(validationErrors) && validationErrors.length > 0) {
        logger.warning(
          new VError(
            {
              name: VERROR_CLUSTER_NAME,
              info: { validationErrors: JSON.stringify(validationErrors) },
            },
            "removed invalid entries from redis during intialization"
          )
        );
      }
      return { ...validatedFallback, ...validatedOldValues };
    });
    registerMessageHandler(FEATURES_CHANNEL, _messageHandler);
  } catch (err) {
    logger.warning(
      isOnCF
        ? new VError(
            {
              name: VERROR_CLUSTER_NAME,
              cause: err,
            },
            "error during initialization, using fallback values"
          )
        : "error during initialization, using fallback values"
    );
    featureValues = validatedFallback;
  }

  const featureCount = configKeys.length;
  logger.info("finished intialization with %i feature toggle%s", featureCount, featureCount === 1 ? "" : "s");
};

/**
 * Get the value of a given feature key or null.
 *
 * Usage:
 *   const FEATURE_VALUE_KEY = "/server/part_x/feature_y"
 *   ...
 *   const result = getFeatureValue(FEATURE_VALUE_KEY);
 *
 * @param key  valid feature key
 * @returns {string|number|boolean|null}
 */
const getFeatureValue = (key) => (Object.prototype.hasOwnProperty.call(featureValues, key) ? featureValues[key] : null);

/**
 * Get a clone of the feature key-value map.
 *
 * @returns {*}
 */
const getFeatureValues = () => ({ ...featureValues });

const _changeRemoteFeatureValuesCallbackFromInput = (validatedInput) => (oldValue) => {
  if (oldValue === null) {
    return null;
  }
  // NOTE keys where value === null are reset to their fallback values, unless the fallback was invalid.
  // If the fallback value is invalid no change is triggered.
  for (const [key, value] of Object.entries(validatedInput)) {
    if (value === null) {
      const [validatedFallbackValue, validationError] = configCache.getSetCb(
        [key, "validatedFallbackValue"],
        ({ fallbackValue }) => {
          if (isNull(fallbackValue)) {
            return [null];
          }
          const validationError = _validateInputEntry(key, fallbackValue);
          return validationError ? [null, validationError] : [fallbackValue];
        },
        config[key]
      );
      if (validatedFallbackValue !== null) {
        validatedInput[key] = validatedFallbackValue;
      } else {
        logger.warning(
          new VError(
            {
              name: VERROR_CLUSTER_NAME,
              info: { key, fallbackValue: config[key].fallbackValue, validationError },
            },
            "could not reset key because fallback is invalid"
          )
        );
        Reflect.deleteProperty(validatedInput, key);
      }
    }
  }

  return { ...oldValue, ...validatedInput };
};

const _changeRemoteFeatureValues = async (input) => {
  const [validatedInput, validationErrors] = validateInput(input);
  if (Array.isArray(validationErrors) && validationErrors.length > 0) {
    return validationErrors;
  }
  if (validatedInput === null) {
    return;
  }
  const newValueCallback = _changeRemoteFeatureValuesCallbackFromInput(validatedInput);
  try {
    await redisWatchedGetSetObject(FEATURES_KEY, newValueCallback);
    await publishMessage(FEATURES_CHANNEL, REFRESH_MESSAGE);
  } catch (err) {
    logger.warning(
      isOnCF
        ? new VError(
            {
              name: VERROR_CLUSTER_NAME,
              cause: err,
              info: {
                input,
                validatedInput,
              },
            },
            "error during change remote feature values, switching to local update"
          )
        : "error during change remote feature values, switching to local update"
    );
    const newFeatureValues = newValueCallback(featureValues);
    await _triggerChangeHandlers(newFeatureValues);
    featureValues = newFeatureValues;
  }
};

/**
 * Remove or change a single feature value.
 *
 * Validation errors are returned in the form [{key, errorMessage},...] if validation fails.
 *
 * Usage:
 *   const FEATURE_VALUE_KEY = "/server/part_x/feature_y"
 *   ...
 *   await changeFeatureValue(FEATURE_VALUE_KEY, "newVal");
 *
 * @see changeFeatureValues
 *
 * @param key       valid feature key
 * @param newValue  new value of valid type or null for deletion
 * @returns {Promise<Array<ValidationError> | void>}
 */
const changeFeatureValue = async (key, newValue) => _changeRemoteFeatureValues({ [key]: newValue });

/**
 * Add, remove, or change some or all feature values. The change is done by mixing in new values to the current state
 * and value = null means reset the respective key to it's fallback value.
 *
 * Validation errors are returned in the form [{key, errorMessage},...] if validation fails.
 *
 * Example:
 *   old_state = { a: "a", b: 2, c: true }, input = { a: null, b: "b", d: 1 }
 *   => new_state = { b: "b", c: true, d: 1 }
 *
 * @see _messageHandler
 * @see _changeRemoteFeatureValuesCallbackFromInput
 *
 * @param input  mixin object
 * @returns {Promise<Array<ValidationError> | void>}
 */
const changeFeatureValues = async (input) => _changeRemoteFeatureValues(input);

const _triggerChangeHandlers = async (newFeatureValues) =>
  Promise.allDone(
    Object.entries(featureValues).map(async ([key, value]) => {
      const newValue = newFeatureValues[key];
      if (!_hasChangeHandlers(key) || newValue === value) {
        return;
      }
      return Promise.allDone(
        featureValuesChangeHandlers[key].map(async (handler) => {
          try {
            await handler(value, newValue);
          } catch (err) {
            logger.error(
              new VError(
                {
                  name: VERROR_CLUSTER_NAME,
                  cause: err,
                  info: {
                    handler: handler.name,
                    key,
                  },
                },
                "error during feature value change handler"
              )
            );
          }
        })
      );
    })
  );

/**
 * Refresh local feature values from redis.
 */
const refreshFeatureValues = async () => {
  try {
    const newFeatureValues = await redisGetObject(FEATURES_KEY);
    if (!newFeatureValues) {
      logger.error(new VError({ name: VERROR_CLUSTER_NAME }, "received empty feature values object from redis"));
      return;
    }
    await _triggerChangeHandlers(newFeatureValues);
    featureValues = newFeatureValues;
  } catch (err) {
    logger.error(new VError({ name: VERROR_CLUSTER_NAME, cause: err }, "error during refresh feature values"));
  }
};

/**
 * Register given handler to receive changes of given feature value key.
 * Errors happening during handler execution will be caught and logged.
 *
 * @param key
 * @param handler signature (oldValue, newValue) => void
 */
const registerFeatureValueChangeHandler = (key, handler) => {
  if (!isInitialized) {
    logger.error(
      new VError(
        {
          name: VERROR_CLUSTER_NAME,
        },
        "called registerFeatureValueChangeHandler before intialize"
      )
    );
    return null;
  }
  if (!isValidFeatureKey(key)) {
    return null;
  }
  if (!_hasChangeHandlers(key)) {
    featureValuesChangeHandlers[key] = [handler];
  } else {
    featureValuesChangeHandlers[key].push(handler);
  }
};

/**
 * Stop given handler from receiving changes of given feature value key.
 *
 * @param key
 * @param handler
 */
const removeFeatureValueChangeHandler = (key, handler) => {
  if (!isInitialized || !isValidFeatureKey(key)) {
    return null;
  }
  if (!_hasChangeHandlers(key)) {
    return;
  }
  const index = featureValuesChangeHandlers[key].findIndex((messageHandler) => messageHandler === handler);
  featureValuesChangeHandlers[key].splice(index, 1);
  if (featureValuesChangeHandlers[key].length === 0) {
    Reflect.deleteProperty(featureValuesChangeHandlers, key);
  }
};

/**
 * Stop all handlers from receiving changes of given feature value key.
 *
 * @param key
 */
const removeAllFeatureValueChangeHandlers = (key) => {
  if (!isInitialized || !isValidFeatureKey(key)) {
    return null;
  }
  if (!_hasChangeHandlers(key)) {
    return;
  }
  Reflect.deleteProperty(featureValuesChangeHandlers, key);
};

module.exports = {
  isValidFeatureValueType,
  isValidFeatureKey,
  validateInput,
  initializeFeatureToggles,
  getFeatureValue,
  getFeatureValues,
  changeFeatureValue,
  changeFeatureValues,
  refreshFeatureValues,
  registerFeatureValueChangeHandler,
  removeFeatureValueChangeHandler,
  removeAllFeatureValueChangeHandlers,

  _: {
    FEATURES_CHANNEL,
    FEATURES_KEY,
    REFRESH_MESSAGE,
    _reset,
    _isInitialized,
    _getFeatureValues,
    _setFeatureValues,
    _getFeatureValuesChangeHandlers,
    _setFeatureValuesChangeHandlers,
    _messageHandler,
    _changeRemoteFeatureValues,
    _changeRemoteFeatureValuesCallbackFromInput,
  },
};
