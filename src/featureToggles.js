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

// TODO locale for validation messages

const { promisify } = require("util");
const path = require("path");
const { readFile } = require("fs");
const VError = require("verror");
const yaml = require("yaml");
const {
  getObject: redisGetObject,
  watchedGetSetObject: redisWatchedGetSetObject,
  publishMessage,
  subscribe: redisSubscribe,
  registerMessageHandler,
} = require("./redisWrapper");
const Logger = require("./logger");
const { LazyCache } = require("./lazyCaches");
const { HandlerCollection } = require("./handlerCollection");
const { ENV, isNull } = require("./helper");
const { isOnCF, cfEnv } = require("./env");

const DEFAULT_FEATURES_CHANNEL = process.env[ENV.CHANNEL] || "features";
const DEFAULT_FEATURES_KEY = process.env[ENV.KEY] || "features";
const DEFAULT_REFRESH_MESSAGE = "refresh";
const DEFAULT_CONFIG_FILEPATH = path.join(process.cwd(), ".featuretogglesrc.yml");
const FEATURE_VALID_TYPES = ["string", "number", "boolean"];

const CACHE_KEY = Object.freeze({
  VALIDATION_REG_EXP: "validationRegExp",
  APP_URL_ACTIVE: "appUrlActive",
  FALLBACK_VALUE_VALIDATION: "fallbackValueValidation",
});

const COMPONENT_NAME = "/FeatureToggles";
const VERROR_CLUSTER_NAME = "FeatureTogglesError";

const readFileAsync = promisify(readFile);
let logger = new Logger(COMPONENT_NAME, isOnCF);

const readConfigFromFile = async (configFilepath = DEFAULT_CONFIG_FILEPATH) => {
  const fileData = await readFileAsync(configFilepath);
  if (/\.ya?ml$/i.test(configFilepath)) {
    return yaml.parse(fileData.toString());
  }
  if (/\.json$/i.test(configFilepath)) {
    return JSON.parse(fileData);
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
   * Populate this.__configCache.
   */
  async _populateConfigCache() {
    const { uris: cfAppUris } = cfEnv.cfApp();
    for (const [key, value] of Object.entries(this.__config)) {
      this.__configCache.setCb(
        [key, CACHE_KEY.VALIDATION_REG_EXP],
        ({ validation }) => (validation ? new RegExp(validation) : null),
        value
      );
      this.__configCache.setCb(
        [key, CACHE_KEY.APP_URL_ACTIVE],
        ({ appUrl }) => {
          if (appUrl) {
            const appUrlRegex = new RegExp(appUrl);
            if (
              Array.isArray(cfAppUris) &&
              !cfAppUris.reduce((current, next) => current && appUrlRegex.test(next), true)
            ) {
              return false;
            }
          }
          return true;
        },
        value
      );
      await this.__configCache.setCbAsync(
        [key, CACHE_KEY.FALLBACK_VALUE_VALIDATION],
        async ({ fallbackValue }) => {
          if (isNull(fallbackValue)) {
            return [null];
          }
          const entryValidationErrors = await this._validateInputEntry(key, fallbackValue);
          return entryValidationErrors ? [null, entryValidationErrors] : [fallbackValue];
        },
        value
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
      return [{ errorMessage: "not initialized" }];
    }
    if (!FeatureToggles._isValidFeatureKey(this.__configKeys, key)) {
      return [{ errorMessage: 'key "{0}" is not valid', errorMessageValues: [key] }];
    }
    // NOTE: value === null is our way of encoding key resetting changes, so it is always allowed
    if (value === null) {
      return;
    }

    const { active, appUrl, type: targetType, validation } = this.__config[key] || {};

    // NOTE: skip validating active properties during initialization
    if (this.__isInitialized) {
      if (active === false) {
        return [{ errorMessage: 'key "{0}" is not active', errorMessageValues: [key] }];
      }

      if (!this.__configCache.get([key, CACHE_KEY.APP_URL_ACTIVE])) {
        return [
          {
            errorMessage: 'key "{0}" is not active because app url does not match regular expression {1}',
            errorMessageValues: [key, appUrl],
          },
        ];
      }
    }

    const valueType = typeof value;
    if (!FeatureToggles._isValidFeatureValueType(value)) {
      return [
        {
          errorMessage: 'value "{0}" has invalid type {1}, must be in {2}',
          errorMessageValues: [value, valueType, FEATURE_VALID_TYPES],
        },
      ];
    }

    if (targetType && valueType !== targetType) {
      return [
        {
          errorMessage: 'value "{0}" has invalid type {1}, must be {2}',
          errorMessageValues: [value, valueType, targetType],
        },
      ];
    }

    const validationRegExp = this.__configCache.get([key, CACHE_KEY.VALIDATION_REG_EXP]);
    if (validationRegExp && !validationRegExp.test(value)) {
      return [
        {
          errorMessage: 'value "{0}" does not match validation regular expression {1}',
          errorMessageValues: [value, validation],
        },
      ];
    }

    for (const validator of this.__featureValueValidators.getHandlers(key)) {
      const validatorName = validator.name || "anonymous";
      try {
        const validationErrorOrErrors = (await validator(value)) || [];
        const validationErrors = Array.isArray(validationErrorOrErrors)
          ? validationErrorOrErrors
          : [validationErrorOrErrors];
        if (validationErrors.length > 0) {
          return validationErrors
            .filter(({ errorMessage }) => errorMessage)
            .map(({ errorMessage, errorMessageValues }) => ({
              errorMessage,
              ...(errorMessageValues && { errorMessageValues }),
            }));
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
        return [
          {
            errorMessage: 'registered validator "{0}" failed for value "{1}" with error {2}',
            errorMessageValues: [validatorName, value, err.message],
          },
        ];
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
    let validationErrors = [];
    if (isNull(input) || typeof input !== "object") {
      return [null, validationErrors];
    }

    let isEmpty = true;
    const result = {};
    for (const [key, value] of Object.entries(input)) {
      const entryValidationErrors = await this._validateInputEntry(key, value);
      if (Array.isArray(entryValidationErrors) && entryValidationErrors.length > 0) {
        const entryValidationErrorsWithKey = entryValidationErrors.map((validationError) => ({
          ...validationError,
          key,
        }));
        validationErrors = validationErrors.concat(entryValidationErrorsWithKey);
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

  async _triggerChangeHandlers(newStateValues) {
    const oldStateValues = this.__stateValues;
    const deltaEntries = [];

    for (const [key, oldValue] of Object.entries(oldStateValues)) {
      const newValue = FeatureToggles._getFeatureValueForStateAndFallback(newStateValues, this.__fallbackValues, key);
      if (newValue !== null && oldValue !== newValue) {
        deltaEntries.push([key, oldValue, newValue]);
      }
    }
    for (const [key, newValue] of Object.entries(newStateValues)) {
      if (Object.prototype.hasOwnProperty.call(oldStateValues, key)) {
        continue;
      }
      const oldValue = this.__fallbackValues[key];
      if (oldValue !== newValue) {
        deltaEntries.push([key, oldValue, newValue]);
      }
    }

    if (deltaEntries.length === 0) {
      return;
    }

    await Promise.all(
      deltaEntries.map(async ([key, oldValue, newValue]) => {
        const handlers = this.__featureValueChangeHandlers.getHandlers(key);
        if (handlers.length === 0) {
          return;
        }

        await Promise.all(
          handlers.map(async (handler) => {
            try {
              return await handler(newValue, oldValue);
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
      const newStateValues = await redisGetObject(this.__featuresKey);
      if (!newStateValues) {
        logger.error(new VError({ name: VERROR_CLUSTER_NAME }, "received empty feature values object from redis"));
        return;
      }

      const [validatedNewStateRaw, validationErrors] = await this.validateInput(newStateValues);
      if (Array.isArray(validationErrors) && validationErrors.length > 0) {
        logger.warning(
          new VError(
            {
              name: VERROR_CLUSTER_NAME,
              info: { validationErrors: JSON.stringify(validationErrors) },
            },
            "received and removed invalid values from redis"
          )
        );
      }
      const validatedNewState = validatedNewStateRaw !== null ? validatedNewStateRaw : {};
      await this._triggerChangeHandlers(validatedNewState);
      this.__stateValues = validatedNewState;
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
  // NOTE constructors cannot be async, so we need to split this state preparation part from the initialize part
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
    this.__fallbackValues = null;
    this.__stateValues = null;
    this.__isInitialized = false;
  }

  // ========================================
  // END OF CONSTRUCTOR SECTION
  // ========================================
  // ========================================
  // START OF INITIALIZE SECTION
  // ========================================

  /**
   * This will filter out inactive values, which is needed during initialization, where inactive keys are not
   * considered invalid.
   */
  _filterInactive(values) {
    return Object.entries(values).reduce((result, [key, value]) => {
      const { active } = this.__config[key] || {};
      if (active !== false && this.__configCache.get([key, CACHE_KEY.APP_URL_ACTIVE])) {
        result[key] = value;
      }
      return result;
    }, {});
  }

  async initializeFeatureValues({ config: configInput, configFile: configFilepath = DEFAULT_CONFIG_FILEPATH }) {
    if (this.__isInitialized) {
      return;
    }

    let config;
    try {
      config = configInput ? configInput : await readConfigFromFile(configFilepath);
      this.__config = config;
      this.__configKeys = Object.keys(this.__config);
      await this._populateConfigCache();
    } catch (err) {
      logger.error(
        new VError(
          {
            name: VERROR_CLUSTER_NAME,
            cause: err,
            info: {
              configFilepath,
              ...(configInput && { configBaseInput: JSON.stringify(configInput) }),
              ...(config && { configBase: JSON.stringify(config) }),
            },
          },
          "initialization aborted, could not resolve configuration"
        )
      );
    }

    this.__fallbackValues = Object.fromEntries(
      Object.entries(this.__config).map(([key, value]) => [key, value.fallbackValue])
    );
    const [validatedFallback, validationErrors] = await this.validateInput(this.__fallbackValues);
    if (Array.isArray(validationErrors) && validationErrors.length > 0) {
      logger.warning(
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
      this.__stateValues = await redisWatchedGetSetObject(this.__featuresKey, async (oldValue) => {
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
        const newValue = { ...validatedFallback, ...validatedOldValues };
        return this._filterInactive(newValue);
      });
      registerMessageHandler(this.__featuresChannel, this.__messageHandler);
      await redisSubscribe(this.__featuresChannel);
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
      this.__stateValues = this._filterInactive(validatedFallback);
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
  // START OF GET_FEATURE_CONFIGS SECTION
  // ========================================

  /**
   * Get feature configuration for specific key.
   */
  getFeatureConfig(key) {
    this._ensureInitialized();
    if (!Object.prototype.hasOwnProperty.call(this.__config, key)) {
      return null;
    }
    const result = { ...this.__config[key] };
    for (const cacheKey of Object.values(CACHE_KEY)) {
      result[cacheKey] = this.__configCache.get([key, cacheKey]);
    }
    return result;
  }

  /**
   * Get feature configurations for all keys.
   */
  getFeatureConfigs() {
    this._ensureInitialized();
    const result = {};
    for (const [key, value] of Object.entries(this.__config)) {
      result[key] = { ...value };
      for (const cacheKey of Object.values(CACHE_KEY)) {
        result[key][cacheKey] = this.__configCache.get([key, cacheKey]);
      }
    }
    return result;
  }

  // ========================================
  // END OF GET_FEATURE_CONFIGS SECTION
  // ========================================
  // ========================================
  // START OF GET_FEATURE_VALUES SECTION
  // ========================================

  static _getFeatureValueForStateAndFallback(stateValues, fallbackValues, key) {
    return Object.prototype.hasOwnProperty.call(stateValues, key)
      ? stateValues[key]
      : Object.prototype.hasOwnProperty.call(fallbackValues, key)
      ? fallbackValues[key]
      : null;
  }

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
    return FeatureToggles._getFeatureValueForStateAndFallback(this.__stateValues, this.__fallbackValues, key);
  }

  /**
   * Get a clone of the feature key-value map.
   *
   * @returns {*}
   */
  getFeatureValues() {
    this._ensureInitialized();
    return { ...this.__fallbackValues, ...this.__stateValues };
  }

  // ========================================
  // END OF GET_FEATURE_VALUES SECTION
  // ========================================
  // ========================================
  // START OF CHANGE_FEATURE_VALUES SECTION
  // ========================================

  _changeRemoteFeatureValuesCallbackFromInput(validatedInput) {
    return (oldValue) => {
      if (oldValue === null) {
        return null;
      }

      const newValue = { ...oldValue, ...validatedInput };

      // NOTE: keys where value === null are reset to their fallback values, unless the fallback was invalid.
      //   If the fallback value is invalid, it is not returned in the new state.
      for (const [key, value] of Object.entries(validatedInput)) {
        if (value === null) {
          const [validatedFallbackValue, entryValidationErrors] = this.__configCache.get([
            key,
            CACHE_KEY.FALLBACK_VALUE_VALIDATION,
          ]);
          if (validatedFallbackValue !== null) {
            newValue[key] = validatedFallbackValue;
          } else {
            logger.warning(
              new VError(
                {
                  name: VERROR_CLUSTER_NAME,
                  info: {
                    key,
                    fallbackValue: this.__config[key].fallbackValue,
                    validationErrors: JSON.stringify(entryValidationErrors),
                  },
                },
                "could not reset key, because fallback is invalid"
              )
            );
            Reflect.deleteProperty(newValue, key);
          }
        }
      }

      return newValue;
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
    const newRedisStateCallback = this._changeRemoteFeatureValuesCallbackFromInput(validatedInput);
    try {
      await redisWatchedGetSetObject(this.__featuresKey, newRedisStateCallback);
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
      // NOTE: in local mode, we trust that the state only contains valid values
      const newStateValues = newRedisStateCallback(this.__stateValues);
      await this._triggerChangeHandlers(newStateValues);
      this.__stateValues = newStateValues;
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
   * @callback handler
   *
   * The change handler gets the new value as well as the old value, immediately after the update is propagated.
   *
   * @param {boolean | number | string} newValue
   * @param {boolean | number | string} oldValue
   */
  /**
   * Register given handler to receive changes of given feature value key.
   * Errors happening during handler execution will be caught and logged.
   *
   * @param key
   * @param handler
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
   * means the new value passes validation, otherwise the validator must return either a single {@link ValidationError},
   * or a list of ValidationErrors.
   *
   * @param {boolean | number | string} newValue
   * @returns {undefined | ValidationError | Array<ValidationError>} in case of failure a ValidationError, or an array
   *   of ValidationErrors, otherwise undefined
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
  readConfigFromFile,

  _: {
    _getLogger: () => logger,
    _setLogger: (value) => (logger = value),
  },
};
