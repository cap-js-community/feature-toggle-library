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
"use strict";

// TODO migrate to redis v4 https://github.com/redis/node-redis/blob/master/docs/v3-to-v4.md

// TODO locale for validation messages

// TODO online documentation covering usage examples incl rest-api and one-key advantages/disadvantages

// TODO we had an interesting case regarding appUrl filters:
//  while running code in excluded appUrls, should getFeatureToggles return
//  (a) null <= current implementation reflecting that the toggle does not exist
//  (b) the fallback value <= could be more intuitive, but also misleading/harder to catch

const { promisify } = require("util");
const path = require("path");
const { readFile } = require("fs");
const VError = require("verror");
const yaml = require("js-yaml");
const {
  registerMessageHandler,
  getObject: redisGetObject,
  watchedGetSetObject: redisWatchedGetSetObject,
  publishMessage,
} = require("./redisWrapper");
const { Logger } = require("./logger");
const { LazyCache } = require("./lazyCaches");
const { HandlerCollection } = require("./handlerCollection");
const { isNull } = require("./helper");
const { isOnCF, cfApp } = require("./env");

const DEFAULT_FEATURES_CHANNEL = process.env.BTP_FEATURES_CHANNEL || "features";
const DEFAULT_FEATURES_KEY = process.env.BTP_FEATURES_KEY || "features";
const DEFAULT_REFRESH_MESSAGE = "refresh";
const DEFAULT_CONFIG_FILEPATH = path.join(process.cwd(), ".featuretogglesrc.yml");
const FEATURE_VALID_TYPES = ["string", "number", "boolean"];

const COMPONENT_NAME = "/FeatureToggles";
const VERROR_CLUSTER_NAME = "FeatureTogglesError";

const readFileAsync = promisify(readFile);
const logger = Logger(COMPONENT_NAME);

const readConfigFromFilepath = async (configFilepath = DEFAULT_CONFIG_FILEPATH) => {
  if (/\.ya?ml$/i.test(configFilepath)) {
    return yaml.load(await readFileAsync(configFilepath));
  }
  if (/\.json$/i.test(configFilepath)) {
    return require(configFilepath);
  }
  throw new VError(
    {
      name: VERROR_CLUSTER_NAME,
      info: { configFilepath },
    },
    "configFilepath with unsupported extension, allowed extensions are .yaml and .json"
  );
};

class FeatureToggles {
  // ========================================
  // START OF CONSTRUCTOR SECTION
  // ========================================

  /**
   * Process base config that is passed in during construction.
   * Goal is to filter out toggles where
   *  - enabled is false or
   *  - appUrl does not match cf app url
   */
  static _processConfigBase(configBase) {
    if (configBase) {
      const cfAppData = cfApp();
      return Object.fromEntries(
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
    }
  }

  static _isValidFeatureKey(configKeys, key) {
    return typeof key === "string" && configKeys.includes(key);
  }

  static _isValidFeatureValueType(value) {
    return value === null || FEATURE_VALID_TYPES.includes(typeof value);
  }

  // NOTE: this function is used during initialization, so we cannot check this.__isInitialized
  async _validateInputEntry(key, value) {
    if (this.__config === null || this.__configKeys === null) {
      return { errorMessage: "not initialized" };
    }
    if (!FeatureToggles._isValidFeatureKey(this.__configKeys, key)) {
      return { key, errorMessage: 'key "{0}" is not valid', errorMessageValues: [key] };
    }
    // NOTE: value === null is our way of encoding key resetting changes, so it is always allowed
    if (value === null) {
      return;
    }

    const valueType = typeof value;
    if (!FeatureToggles._isValidFeatureValueType(value)) {
      return {
        key,
        errorMessage: 'value "{0}" has invalid type {1}, must be in {2}',
        errorMessageValues: [value, valueType, FEATURE_VALID_TYPES],
      };
    }

    const { type: targetType, validation } = this.__config[key];
    if (targetType && valueType !== targetType) {
      return {
        key,
        errorMessage: 'value "{0}" has invalid type {1}, must be {2}',
        errorMessageValues: [value, valueType, targetType],
      };
    }

    const validationRegExp = this.__configCache.getSetCb(
      [key, "validationRegExp"],
      ({ validation }) => (validation ? new RegExp(validation) : null),
      this.__config[key]
    );
    if (validationRegExp && !validationRegExp.test(value)) {
      return {
        key,
        errorMessage: 'value "{0}" does not match validation regular expression {1}',
        errorMessageValues: [value, validation],
      };
    }

    for (const validator of this.__featureValueValidators.getHandlers(key)) {
      const validatorName = validator.name || "anonymous";
      try {
        const { errorMessage, errorMessageValues } = (await validator(value)) || {};
        if (errorMessage) {
          return {
            key,
            errorMessage,
            errorMessageValues: errorMessageValues || [],
          };
        }
      } catch (err) {
        logger.error(
          new VError(
            {
              name: VERROR_CLUSTER_NAME,
              cause: err,
              info: {
                validator: validatorName,
                key,
                value,
              },
            },
            "error during registered validator"
          )
        );
        return {
          key,
          errorMessage: 'registered validator "{0}" failed for value "{1}" with error {2}',
          errorMessageValues: [validatorName, value, err.message],
        };
      }
    }
  }

  /**
   * @typedef ValidationError
   * ValidationError must have a user-readable errorMessage. The message can use errorMessageValues, i.e., parameters
   * which are ignored for localization, but mixed in when the errorMessage is presented to the user.
   *
   * Example:
   *   { errorMessage: "got bad value" },
   *   { errorMessage: 'got bad value with parameter "{0}"', errorMessageValues: [paramFromValue(value)] }
   *
   * @type object
   * @property {string} key feature toggle
   * @property {string} errorMessage user-readable error message
   * @property {Array<string>} [errorMessageValues] optional parameters for error message, which are irgnored for localization
   */
  /**
   * Will return a pair [result, validationErrors], where validationErrors is a list of ValidationError objects
   * and result are all inputs that passed validated or null for illegal/empty input.
   *
   * @param input
   * @returns {[null|*, Array<ValidationError>]}
   */
  async validateInput(input) {
    const validationErrors = [];
    if (isNull(input) || typeof input !== "object") {
      return [null, validationErrors];
    }

    let isEmpty = true;
    const result = {};
    for (const [key, value] of Object.entries(input)) {
      const validationError = await this._validateInputEntry(key, value);
      if (validationError) {
        validationErrors.push(validationError);
      } else {
        isEmpty = false;
        result[key] = value;
      }
    }

    if (isEmpty) {
      return [null, validationErrors];
    }

    return [result, validationErrors];
  }

  async _triggerChangeHandlers(newFeatureValues) {
    const featureValueEntries = Object.entries(this.__featureValues);
    return featureValueEntries.length === 0
      ? null
      : await Promise.all(
          featureValueEntries.map(async ([key, value]) => {
            const newValue = newFeatureValues[key];
            const handlers = this.__featureValueChangeHandlers.getHandlers(key);
            return newValue === value || handlers.length === 0
              ? null
              : await Promise.all(
                  handlers.map(async (handler) => {
                    try {
                      return await handler(key, value);
                    } catch (err) {
                      logger.error(
                        new VError(
                          {
                            name: VERROR_CLUSTER_NAME,
                            cause: err,
                            info: {
                              handler: handler.name || "anonymous",
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
  }

  _ensureInitialized() {
    if (this.__isInitialized) {
      return;
    }
    throw new VError(
      { name: VERROR_CLUSTER_NAME },
      "feature toggles API called, but class instance is not initialized"
    );
  }

  /**
   * Refresh local feature values from redis.
   */
  async refreshFeatureValues() {
    this._ensureInitialized();
    try {
      const newFeatureValues = await redisGetObject(this.__featuresKey);
      if (!newFeatureValues) {
        logger.error(new VError({ name: VERROR_CLUSTER_NAME }, "received empty feature values object from redis"));
        return;
      }
      await this._triggerChangeHandlers(newFeatureValues);
      this.__featureValues = newFeatureValues;
    } catch (err) {
      logger.error(new VError({ name: VERROR_CLUSTER_NAME, cause: err }, "error during refresh feature values"));
    }
  }

  /**
   * Handler for refresh message.
   */
  async _messageHandler(input) {
    try {
      if (input !== this.__refreshMessage) {
        return;
      }
      await this.refreshFeatureValues();
    } catch (err) {
      logger.error(
        new VError(
          {
            name: VERROR_CLUSTER_NAME,
            cause: err,
            info: {
              channel: this.__featuresChannel,
            },
          },
          "error during message handling"
        )
      );
    }
  }

  /**
   * Call this with
   * - your configuration object or
   * - local filepath to a yaml file with your configuration object (recommended)
   * to initialize the feature toggles. For example during service loading.
   *
   * For syntax and details regarding the configuration object refer to README.md.
   */
  // NOTE constructors cannot be async, so we need to split this state preparation part from the intialize part
  constructor({
    uniqueName,
    featuresChannel = DEFAULT_FEATURES_CHANNEL,
    featuresKey = DEFAULT_FEATURES_KEY,
    refreshMessage = DEFAULT_REFRESH_MESSAGE,
  } = {}) {
    this.__featuresChannel = uniqueName ? featuresChannel + "-" + uniqueName : featuresChannel;
    this.__featuresKey = uniqueName ? featuresKey + "-" + uniqueName : featuresKey;
    this.__refreshMessage = refreshMessage;

    this.__configCache = new LazyCache();
    this.__featureValueChangeHandlers = new HandlerCollection();
    this.__featureValueValidators = new HandlerCollection();
    this.__messageHandler = this._messageHandler.bind(this); // needed for testing

    this.__config = null;
    this.__configKeys = null;
    this.__featureValues = null;
    this.__isInitialized = false;
  }

  // ========================================
  // END OF CONSTRUCTOR SECTION
  // ========================================
  // ========================================
  // START OF INITIALIZE SECTION
  // ========================================

  async initializeFeatureValues({ config: configBaseInput, configFile: configFilepath = DEFAULT_CONFIG_FILEPATH }) {
    if (this.__isInitialized) {
      return;
    }

    let configBase;
    try {
      configBase = configBaseInput ? configBaseInput : await readConfigFromFilepath(configFilepath);
      this.__config = FeatureToggles._processConfigBase(configBase);
      this.__configKeys = Object.keys(this.__config);
    } catch (err) {
      logger.error(
        new VError(
          {
            name: VERROR_CLUSTER_NAME,
            cause: err,
            info: {
              configFilepath,
              ...(configBaseInput && { configBaseInput: JSON.stringify(configBaseInput) }),
              ...(configBase && { configBase: JSON.stringify(configBase) }),
            },
          },
          "initializtion aborted, could not resolve configuration"
        )
      );
    }

    const featureValuesFallback = Object.fromEntries(
      Object.entries(this.__config).map(([key, value]) => [key, value.fallbackValue])
    );
    const [validatedFallback, validationErrors] = await this.validateInput(featureValuesFallback);
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
      this.__featureValues = await redisWatchedGetSetObject(this.__featuresKey, async (oldValue) => {
        const [validatedOldValues, validationErrors] = await this.validateInput(oldValue);
        if (Array.isArray(validationErrors) && validationErrors.length > 0) {
          logger.warning(
            new VError(
              {
                name: VERROR_CLUSTER_NAME,
                info: { validationErrors: JSON.stringify(validationErrors) },
              },
              "removed invalid entries from redis during initialization"
            )
          );
        }
        return { ...validatedFallback, ...validatedOldValues };
      });
      registerMessageHandler(this.__featuresChannel, this.__messageHandler);
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
      this.__featureValues = validatedFallback;
    }

    const featureCount = this.__configKeys.length;
    logger.info("finished initialization with %i feature toggle%s", featureCount, featureCount === 1 ? "" : "s");
    this.__isInitialized = true;
    return this;
  }

  // ========================================
  // END OF INITIALIZE SECTION
  // ========================================
  // ========================================
  // START OF GET_FEATURE_VALUES SECTION
  // ========================================

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
  getFeatureValue(key) {
    this._ensureInitialized();
    return Object.prototype.hasOwnProperty.call(this.__featureValues, key) ? this.__featureValues[key] : null;
  }

  /**
   * Get a clone of the feature key-value map.
   *
   * @returns {*}
   */
  getFeatureValues() {
    this._ensureInitialized();
    return { ...this.__featureValues };
  }

  // ========================================
  // END OF GET_FEATURE_VALUES SECTION
  // ========================================
  // ========================================
  // START OF CHANGE_FEATURE_VALUES SECTION
  // ========================================

  _changeRemoteFeatureValuesCallbackFromInput(validatedInput) {
    return async (oldValue) => {
      if (oldValue === null) {
        return null;
      }
      // NOTE keys where value === null are reset to their fallback values, unless the fallback was invalid.
      // If the fallback value is invalid no change is triggered.
      for (const [key, value] of Object.entries(validatedInput)) {
        if (value === null) {
          const [validatedFallbackValue, validationError] = await this.__configCache.getSetCbAsync(
            [key, "validatedFallbackValue"],
            async ({ fallbackValue }) => {
              if (isNull(fallbackValue)) {
                return [null];
              }
              const validationError = await this._validateInputEntry(key, fallbackValue);
              return validationError ? [null, validationError] : [fallbackValue];
            },
            this.__config[key]
          );
          if (validatedFallbackValue !== null) {
            validatedInput[key] = validatedFallbackValue;
          } else {
            logger.warning(
              new VError(
                {
                  name: VERROR_CLUSTER_NAME,
                  info: { key, fallbackValue: this.__config[key].fallbackValue, validationError },
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
  }

  async _changeRemoteFeatureValues(input) {
    const [validatedInput, validationErrors] = await this.validateInput(input);
    if (Array.isArray(validationErrors) && validationErrors.length > 0) {
      return validationErrors;
    }
    if (validatedInput === null) {
      return;
    }
    const newValueCallback = this._changeRemoteFeatureValuesCallbackFromInput(validatedInput);
    try {
      await redisWatchedGetSetObject(this.__featuresKey, newValueCallback);
      await publishMessage(this.__featuresChannel, this.__refreshMessage);
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
      const newFeatureValues = newValueCallback(this.__featureValues);
      await this._triggerChangeHandlers(newFeatureValues);
      this.__featureValues = newFeatureValues;
    }
  }

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
  async changeFeatureValue(key, newValue) {
    this._ensureInitialized();
    return this._changeRemoteFeatureValues({ [key]: newValue });
  }

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
  async changeFeatureValues(input) {
    this._ensureInitialized();
    return this._changeRemoteFeatureValues(input);
  }

  // ========================================
  // END OF CHANGE_FEATURE_VALUES SECTION
  // ========================================
  // ========================================
  // START OF FEATURE_VALUE_CHANGE_HANDLER SECTION
  // ========================================

  /**
   * Register given handler to receive changes of given feature value key.
   * Errors happening during handler execution will be caught and logged.
   *
   * @param key
   * @param handler signature (oldValue, newValue) => void
   */
  registerFeatureValueChangeHandler(key, handler) {
    this.__featureValueChangeHandlers.registerHandler(key, handler);
  }

  /**
   * Stop given handler from receiving changes of given feature value key.
   *
   * @param key
   * @param handler
   */
  removeFeatureValueChangeHandler(key, handler) {
    this.__featureValueChangeHandlers.removeHandler(key, handler);
  }

  /**
   * Stop all handlers from receiving changes of given feature value key.
   *
   * @param key
   */
  removeAllFeatureValueChangeHandlers(key) {
    this.__featureValueChangeHandlers.removeAllHandlers(key);
  }

  // ========================================
  // END OF FEATURE_VALUE_CHANGE_HANDLER SECTION
  // ========================================
  // ========================================
  // START OF FEATURE_VALUE_EXTERNAL_VALIDATION SECTION
  // ========================================

  /**
   * @callback validator
   *
   * The validator gets the new value and can do any number of checks on it. Returning anything falsy, like undefined,
   * means the new value passes validation, otherwise the validator must return a {@link ValidationError}.
   *
   * @param {boolean | number | string} newValue
   * @returns {undefined | ValidationError} in case of failure a ValidationError otherwise undefined
   */
  /**
   * Register a validator for given feature value key. If you register a validator _before_ initialization, it will
   * be executed during initialization, otherwise it will only run for new values coming in after initialization.
   * Errors happening during validation execution will be logged and communicated to user as generic problem.
   *
   * usage:
   * registerFeatureValueValidation(key, (newValue) => {
   *   if (isBad(newValue)) {
   *     return { errorMessage: "got bad value" };
   *   }
   *   if (isWorse(newValue)) {
   *     return { errorMessage: 'got bad value with parameter "{0}"', errorMessageValues: [paramFromValue(value)] };
   *   }
   * });
   *
   * @param key
   * @param validator
   */
  registerFeatureValueValidation(key, validator) {
    this.__featureValueValidators.registerHandler(key, validator);
  }

  /**
   * Stop given validation for a given feature value key.
   *
   * @param key
   * @param validator
   */
  removeFeatureValueValidation(key, validator) {
    this.__featureValueValidators.removeHandler(key, validator);
  }

  /**
   * Stop all validation for a given feature value key.
   *
   * @param key
   */
  removeAllFeatureValueValidation(key) {
    this.__featureValueValidators.removeAllHandlers(key);
  }

  // ========================================
  // END OF FEATURE_VALUE_EXTERNAL_VALIDATION SECTION
  // ========================================
}

module.exports = {
  FeatureToggles,
  readConfigFromFilepath,

  _: {
    _getLogger: () => logger,
  },
};
