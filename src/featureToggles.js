/**
 * SAP BTP Feature Toggle Library
 *
 * {@link https://cap-js-community.github.io/feature-toggle-library/ Documentation}
 *
 * important usage functions:
 * @see getFeatureValue
 * @see changeFeatureValue
 * @see registerFeatureValueChangeHandler
 */

"use strict";

// TODO setting toggles to inactive should not delete remote state
// TODO locale for validation messages

const { promisify } = require("util");
const path = require("path");
const { readFile } = require("fs");
const VError = require("verror");
const yaml = require("yaml");
const {
  getIntegrationMode: getRedisIntegrationMode,
  getObject: redisGetObject,
  watchedHashGetSetObject: redisWatchedHashGetSetObject,
  publishMessage,
  subscribe: redisSubscribe,
  registerMessageHandler,
} = require("./redisWrapper");
const { Logger } = require("./logger");
const { isOnCF, cfEnv } = require("./env");
const { HandlerCollection } = require("./shared/handlerCollection");
const { ENV, isNull } = require("./shared/static");
const { promiseAllDone } = require("./shared/promiseAllDone");
const { LimitedLazyCache } = require("./shared/cache");

const DEFAULT_FEATURES_CHANNEL = process.env[ENV.CHANNEL] || "features";
const DEFAULT_FEATURES_KEY = process.env[ENV.KEY] || "features";
const DEFAULT_CONFIG_FILEPATH = path.join(process.cwd(), ".featuretogglesrc.yml");
const FEATURE_VALID_TYPES = ["string", "number", "boolean"];

const SUPER_SCOPE_CACHE_SIZE_LIMIT = 15;
const SCOPE_KEY_INNER_SEPARATOR = "::";
const SCOPE_KEY_OUTER_SEPARATOR = "##";
const SCOPE_ROOT_KEY = "//";

const CONFIG_CACHE_KEY = Object.freeze({
  TYPE: "TYPE",
  ACTIVE: "ACTIVE",
  APP_URL: "APP_URL",
  VALIDATION: "VALIDATION",
  APP_URL_ACTIVE: "APP_URL_ACTIVE",
  VALIDATION_REG_EXP: "VALIDATION_REG_EXP",
});

const COMPONENT_NAME = "/FeatureToggles";
const VERROR_CLUSTER_NAME = "FeatureTogglesError";

const SCOPE_PREFERENCE_ORDER_MASKS = [
  [parseInt("10", 2), parseInt("01", 2)],
  [
    parseInt("110", 2),
    parseInt("101", 2),
    parseInt("011", 2),

    parseInt("100", 2),
    parseInt("010", 2),
    parseInt("001", 2),
  ],
  [
    parseInt("1110", 2),
    parseInt("1101", 2),
    parseInt("1011", 2),
    parseInt("0111", 2),

    parseInt("1100", 2),
    parseInt("1010", 2),
    parseInt("1001", 2),
    parseInt("0101", 2),
    parseInt("0110", 2),
    parseInt("0011", 2),

    parseInt("1000", 2),
    parseInt("0100", 2),
    parseInt("0010", 2),
    parseInt("0001", 2),
  ],
];

const readFileAsync = promisify(readFile);
let logger = new Logger(COMPONENT_NAME, isOnCF);

const readConfigFromFile = async (configFilepath = DEFAULT_CONFIG_FILEPATH) => {
  const fileData = await readFileAsync(configFilepath);
  if (/\.ya?ml$/i.test(configFilepath)) {
    return yaml.parse(fileData.toString());
  }
  if (/\.json$/i.test(configFilepath)) {
    return JSON.parse(fileData.toString());
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
   * Populate this.__config.
   */
  _processConfig(config) {
    const { uris: cfAppUris } = cfEnv.cfApp();

    const configEntries = Object.entries(config);
    for (const [key, { type, active, appUrl, validation, fallbackValue }] of configEntries) {
      this.__keys.push(key);
      this.__fallbackValues[key] = fallbackValue;
      this.__config[key] = {};

      if (type) {
        this.__config[key][CONFIG_CACHE_KEY.TYPE] = type;
      }

      if (active !== undefined) {
        this.__config[key][CONFIG_CACHE_KEY.ACTIVE] = active;
      }

      if (validation) {
        this.__config[key][CONFIG_CACHE_KEY.VALIDATION] = validation;
        this.__config[key][CONFIG_CACHE_KEY.VALIDATION_REG_EXP] = new RegExp(validation);
      }

      if (appUrl) {
        this.__config[key][CONFIG_CACHE_KEY.APP_URL] = appUrl;

        const appUrlRegex = new RegExp(appUrl);
        this.__config[key][CONFIG_CACHE_KEY.APP_URL_ACTIVE] =
          !Array.isArray(cfAppUris) ||
          cfAppUris.reduce((accumulator, cfAppUri) => accumulator && appUrlRegex.test(cfAppUri), true);
      }
    }

    this.__isConfigProcessed = true;
    return configEntries.length;
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
   * Call this with
   * - your configuration object or
   * - local filepath to a yaml file with your configuration object (recommended)
   * to initialize the feature toggles. For example during service loading.
   *
   * For syntax and details regarding the configuration object refer to README.md.
   */
  // NOTE: constructors cannot be async, so we need to split this state preparation part from the initialize part
  constructor({ uniqueName, featuresChannel = DEFAULT_FEATURES_CHANNEL, featuresKey = DEFAULT_FEATURES_KEY } = {}) {
    this.__featuresChannel = uniqueName ? featuresChannel + "-" + uniqueName : featuresChannel;
    this.__featuresKey = uniqueName ? featuresKey + "-" + uniqueName : featuresKey;

    this.__featureValueChangeHandlers = new HandlerCollection();
    this.__featureValueValidators = new HandlerCollection();
    this.__messageHandler = this._messageHandler.bind(this); // needed for testing
    this.__superScopeCache = new LimitedLazyCache({ sizeLimit: SUPER_SCOPE_CACHE_SIZE_LIMIT });

    this.__config = {};
    this.__keys = [];
    this.__fallbackValues = {};
    this.__stateScopedValues = {};
    this.__isInitialized = false;
    this.__isConfigProcessed = false;
  }

  // ========================================
  // END OF CONSTRUCTOR SECTION
  // ========================================
  // ========================================
  // START OF VALIDATION SECTION
  // ========================================

  static _isValidFeatureKey(fallbackValues, key) {
    return typeof key === "string" && Object.prototype.hasOwnProperty.call(fallbackValues, key);
  }

  static _isValidFeatureValueType(value) {
    return value === null || FEATURE_VALID_TYPES.includes(typeof value);
  }

  static _isValidScopeKey(scopeKey) {
    return scopeKey === undefined || typeof scopeKey === "string";
  }

  // NOTE: this function is used during initialization, so we cannot check this.__isInitialized
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
   * @property {string}        key                   feature toggle
   * @property {string}        errorMessage          user-readable error message
   * @property {Array<string>} [errorMessageValues]  optional parameters for error message, which are ignored for localization
   */
  /**
   * Validate the value of a given key, value pair. Allows passing an optional scopeKey that is added to
   * validationErrors for reference.
   *
   * @param {string}                      key         feature key
   * @param {string|number|boolean|null}  value       intended value
   * @param {string|undefined}            [scopeKey]  optional scopeKey for reference
   * @returns {Promise<Array<ValidationError>>}       validation errors if any are found or an empty array otherwise
   */
  async validateFeatureValue(key, value, scopeKey = undefined) {
    if (!this.__isConfigProcessed) {
      return [{ errorMessage: "not initialized" }];
    }

    if (!FeatureToggles._isValidFeatureKey(this.__fallbackValues, key)) {
      return [{ key, errorMessage: "key is not valid" }];
    }

    if (!FeatureToggles._isValidScopeKey(scopeKey)) {
      return [{ key, scopeKey, errorMessage: "scopeKey is not valid" }];
    }

    // NOTE: value === null is our way of encoding key resetting changes, so it is always allowed
    if (value === null) {
      return [];
    }

    // NOTE: skip validating active properties during initialization
    if (this.__isInitialized) {
      if (this.__config[key][CONFIG_CACHE_KEY.ACTIVE] === false) {
        return [{ key, errorMessage: "key is not active" }];
      }

      if (this.__config[key][CONFIG_CACHE_KEY.APP_URL_ACTIVE] === false) {
        return [
          {
            key,
            errorMessage: "key is not active because app url does not match regular expression {1}",
            errorMessageValues: [this.__config[key][CONFIG_CACHE_KEY.APP_URL]],
          },
        ];
      }
    }

    const valueType = typeof value;
    if (!FeatureToggles._isValidFeatureValueType(value)) {
      return [
        {
          key,
          ...(scopeKey && { scopeKey }),
          errorMessage: 'value "{0}" has invalid type {1}, must be in {2}',
          errorMessageValues: [value, valueType, FEATURE_VALID_TYPES],
        },
      ];
    }

    if (valueType !== this.__config[key][CONFIG_CACHE_KEY.TYPE]) {
      return [
        {
          key,
          ...(scopeKey && { scopeKey }),
          errorMessage: 'value "{0}" has invalid type {1}, must be {2}',
          errorMessageValues: [value, valueType, this.__config[key][CONFIG_CACHE_KEY.TYPE]],
        },
      ];
    }

    const validationRegExp = this.__config[key][CONFIG_CACHE_KEY.VALIDATION_REG_EXP];
    if (validationRegExp && !validationRegExp.test(value)) {
      return [
        {
          key,
          ...(scopeKey && { scopeKey }),
          errorMessage: 'value "{0}" does not match validation regular expression {1}',
          errorMessageValues: [value, this.__config[key][CONFIG_CACHE_KEY.VALIDATION]],
        },
      ];
    }

    const validators = this.__featureValueValidators.getHandlers(key);
    if (validators.length === 0) {
      return [];
    }
    const validatorErrors = await Promise.all(
      validators.map(async (validator) => {
        const validatorName = validator.name || "anonymous";
        try {
          const validationErrorOrErrors = (await validator(value, scopeKey)) || [];
          const validationErrors = Array.isArray(validationErrorOrErrors)
            ? validationErrorOrErrors
            : [validationErrorOrErrors];
          return validationErrors.length > 0
            ? validationErrors
                .filter(({ errorMessage }) => errorMessage)
                .map(({ errorMessage, errorMessageValues }) => ({
                  key,
                  ...(scopeKey && { scopeKey }),
                  errorMessage,
                  ...(errorMessageValues && { errorMessageValues }),
                }))
            : [];
        } catch (err) {
          logger.error(
            new VError(
              {
                name: VERROR_CLUSTER_NAME,
                cause: err,
                info: {
                  validator: validatorName,
                  key,
                  ...(scopeKey && { scopeKey }),
                  value,
                },
              },
              "error during registered validator"
            )
          );
          return [
            {
              key,
              ...(scopeKey && { scopeKey }),
              errorMessage: 'registered validator "{0}" failed for value "{1}" with error {2}',
              errorMessageValues: [validatorName, value, err.message],
            },
          ];
        }
      })
    );
    return validatorErrors.flat();
  }

  /**
   * Validate the fallback values. This will only return an array of validation errors, but not an object with
   * validated values, because fallback values are used even when they are invalid.
   */
  async _validateFallbackValues(fallbackValues) {
    let validationErrors = [];
    if (isNull(fallbackValues) || typeof fallbackValues !== "object") {
      return validationErrors;
    }

    for (const [key, value] of Object.entries(fallbackValues)) {
      const entryValidationErrors = await this.validateFeatureValue(key, value);
      if (Array.isArray(entryValidationErrors) && entryValidationErrors.length > 0) {
        validationErrors = validationErrors.concat(entryValidationErrors);
      }
    }
    return validationErrors;
  }

  // TODO can this mechanism of using [result, errors] per key inside a loop be generalized?
  async _validateScopedValues(key, scopedValues) {
    let validationErrors = [];
    const validatedScopedValues = {};
    const processEntry = async (key, value, scopeKey) => {
      const entryValidationErrors = await this.validateFeatureValue(key, value, scopeKey);
      if (Array.isArray(entryValidationErrors) && entryValidationErrors.length > 0) {
        validationErrors = validationErrors.concat(entryValidationErrors);
      } else {
        FeatureToggles._updateScopedValues(validatedScopedValues, key, value, scopeKey);
      }
    };

    // NOTE: this is the migration case
    if (typeof scopedValues !== "object") {
      await processEntry(key, scopedValues);
    } else {
      for (const [scopeKey, value] of Object.entries(scopedValues)) {
        await processEntry(key, value, scopeKey);
      }
    }

    return [validatedScopedValues, validationErrors];
  }

  /**
   * Validate the remote state scoped values. This will return a pair [result, validationErrors], where
   * validationErrors is a list of {@link ValidationError} objects and result are all inputs that passed validated or
   * null for illegal or empty input.
   *
   * @param stateScopedValues
   * @returns {Promise<[null|*, Array<ValidationError>]>}
   */
  async _validateStateScopedValues(stateScopedValues) {
    let validationErrors = [];
    const validatedStateScopedValues = {};
    if (isNull(stateScopedValues) || typeof stateScopedValues !== "object") {
      return [null, validationErrors];
    }

    for (const [key, scopedValues] of Object.entries(stateScopedValues)) {
      const [validatedScopedValues, validationErrorsScopedValues] = this._validateScopedValues(key, scopedValues);
      validationErrors = validationErrors.concat(validationErrorsScopedValues);
      // TODO can this be undefined?
      if (validatedScopedValues !== null && validatedScopedValues !== undefined) {
        validatedStateScopedValues[key] = validatedScopedValues;
      }
    }
    return [validatedStateScopedValues, validationErrors];
  }

  // ========================================
  // END OF VALIDATION SECTION
  // ========================================
  // ========================================
  // START OF INITIALIZE SECTION
  // ========================================

  _isKeyInactive(key) {
    return (
      this.__config[key][CONFIG_CACHE_KEY.ACTIVE] !== false &&
      this.__config[key][CONFIG_CACHE_KEY.APP_URL_ACTIVE] !== false
    );
  }

  async initializeFeatureValues({ config: configInput, configFile: configFilepath = DEFAULT_CONFIG_FILEPATH }) {
    if (this.__isInitialized) {
      return;
    }

    let config;
    try {
      config = configInput ? configInput : await readConfigFromFile(configFilepath);
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

    const toggleCount = this._processConfig(config);

    const validationErrors = await this._validateFallbackValues(this.__fallbackValues);
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
      // TODO double check behavior for inactive
      this.__stateScopedValues = await this.__keys.reduce(async (stateScopedValues, key) => {
        if (!this._isKeyInactive(key)) {
          const scopedValues = await redisWatchedHashGetSetObject(this.__featuresKey, key, async (scopedValues) => {
            const [validatedScopedValues, validationErrors] = await this._validateScopedValues(key, scopedValues);
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
            return validatedScopedValues;
          });
          if (scopedValues) {
            stateScopedValues = await stateScopedValues;
            stateScopedValues[key] = scopedValues;
          }
        }
        return stateScopedValues;
      }, Promise.resolve({}));

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
    }

    logger.info(
      "finished initialization with %i feature toggle%s with %s",
      toggleCount,
      toggleCount === 1 ? "" : "s",
      getRedisIntegrationMode()
    );
    this.__isInitialized = true;
    return this;
  }

  // ========================================
  // END OF INITIALIZE SECTION
  // ========================================
  // ========================================
  // START OF GET_FEATURE_STATES SECTION
  // ========================================

  _getFeatureState(key) {
    return {
      fallbackValue: this.__fallbackValues[key],
      stateScopedValues: this.__stateScopedValues[key],
      config: this.__config[key],
    };
  }

  /**
   * Get feature state for specific key.
   */
  getFeatureState(key) {
    this._ensureInitialized();
    if (!Object.prototype.hasOwnProperty.call(this.__fallbackValues, key)) {
      return null;
    }
    return this._getFeatureState(key);
  }

  /**
   * Get feature configurations for all keys.
   */
  getFeatureStates() {
    this._ensureInitialized();
    const result = {};
    for (const key of this.__keys) {
      result[key] = this._getFeatureState(key);
    }
    return result;
  }

  // ========================================
  // END OF GET_FEATURE_STATES SECTION
  // ========================================
  // ========================================
  // START OF GET_FEATURE_VALUE SECTION
  // ========================================

  static getScopeKey(scopeMap) {
    return typeof scopeMap !== "object" || scopeMap === null
      ? SCOPE_ROOT_KEY
      : FeatureToggles._getNonRootScopeKey(scopeMap, Object.keys(scopeMap).sort());
  }

  static _getNonRootScopeKey(scopeMap, sortedKeys) {
    return sortedKeys.map((key) => key + SCOPE_KEY_INNER_SEPARATOR + scopeMap[key]).join(SCOPE_KEY_OUTER_SEPARATOR);
  }

  // NOTE: there are multiple scopeMaps for every scopeKey with more than one inner entry. This will return the unique
  // scopeMap whose keys are sorted, i.e., matching the keys in the scopeKey.
  static getScopeMap(scopeKey) {
    return typeof scopeKey !== "string" || scopeKey === SCOPE_ROOT_KEY
      ? {}
      : scopeKey.split(SCOPE_KEY_OUTER_SEPARATOR).reduce((acc, innerScopeEntry) => {
          const [key, value] = innerScopeEntry.split(SCOPE_KEY_INNER_SEPARATOR);
          acc[key] = value;
          return acc;
        }, {});
  }

  // NOTE: this does not return the scope root key, which is a super scope of every scope, because we handle this case
  // separately in _getFeatureValueForScopeAndStateAndFallback
  static _getNonRootSuperScopeKeys(superScopeCache, scopeMap) {
    const scopeMapKeys = Object.keys(scopeMap);

    const n = scopeMapKeys.length - 1;
    if (n > SCOPE_PREFERENCE_ORDER_MASKS.length) {
      logger.error(
        new VError(
          {
            name: VERROR_CLUSTER_NAME,
            info: {
              scopeMap: JSON.stringify(scopeMap),
              maxKeys: SCOPE_PREFERENCE_ORDER_MASKS.length + 1,
            },
          },
          "scope exceeds allowed number of keys"
        )
      );
      return [];
    }

    const scopeKey = FeatureToggles._getNonRootScopeKey(scopeMap, scopeMapKeys.slice().sort());
    if (n === 0) {
      return [scopeKey];
    }

    // NOTE: it's tempting to take the scopeKey as cacheKey here. The problem is that we want to allow the order of the
    // scopeMap keys to determine the superScopeKeys ordering (see tests). This means we cannot cache with scopeKey,
    // because it is stable for all scopeMap key orderings.
    const cacheKey = JSON.stringify(scopeMap);
    return superScopeCache.getSetCb(cacheKey, () => {
      const result = [scopeKey];
      for (const selectMask of SCOPE_PREFERENCE_ORDER_MASKS[n - 1]) {
        const selectedKeys = scopeMapKeys.filter((_, keyIndex) => selectMask & (1 << (n - keyIndex)));
        result.push(FeatureToggles._getNonRootScopeKey(scopeMap, selectedKeys.sort()));
      }
      return result;
    });
  }

  static _getFeatureValueForScopeAndStateAndFallback(
    superScopeCache,
    stateScopedValues,
    fallbackValues,
    key,
    scopeMap = undefined
  ) {
    const keyState = stateScopedValues[key];
    const fallbackValue = fallbackValues[key] ?? null;

    if (keyState === undefined) {
      return fallbackValue;
    }

    const scopeRootValue = keyState[SCOPE_ROOT_KEY] ?? fallbackValue;
    if (scopeMap === undefined) {
      return scopeRootValue;
    }

    for (const superScopeKey of FeatureToggles._getNonRootSuperScopeKeys(superScopeCache, scopeMap)) {
      const scopedValue = keyState[superScopeKey];
      if (scopedValue) {
        return scopedValue;
      }
    }
    return scopeRootValue;
  }

  /**
   * Get the value of a given feature key or null.
   *
   * Usage:
   *   const FEATURE_VALUE_KEY = "/server/part_x/feature_y"
   *   ...
   *   const result = getFeatureValue(FEATURE_VALUE_KEY);
   *   const resultForTenant = getFeatureValue(FEATURE_VALUE_KEY, { tenantId: "tenant123" });
   *
   * @param key         valid feature key
   * @param [scopeMap]  object containing scope restrictions
   * @returns {string|number|boolean|null}
   */
  getFeatureValue(key, scopeMap) {
    this._ensureInitialized();
    return FeatureToggles._getFeatureValueForScopeAndStateAndFallback(
      this.__superScopeCache,
      this.__stateScopedValues,
      this.__fallbackValues,
      key,
      scopeMap
    );
  }

  // ========================================
  // END OF GET_FEATURE_VALUE SECTION
  // ========================================
  // ========================================
  // START OF CHANGE_FEATURE_VALUE SECTION
  // ========================================

  // TODO this naming is horrific stateScopedValues are scopedValues for all Keys but they sound like the same thing
  // TODO this function is also horrific by modifying in place and still needing the user to use the return value,
  //  because it needs to communicate the delete case
  static _updateScopedValues(scopedValues, newValue, scopeKey = SCOPE_ROOT_KEY, { clearSubScopes = false } = {}) {
    // NOTE: this first check is just an optimization
    if (clearSubScopes && scopeKey === SCOPE_ROOT_KEY) {
      return null;
    }

    if (scopedValues) {
      if (clearSubScopes) {
        const scopeKeyInnerPairs = scopeKey.split(SCOPE_KEY_OUTER_SEPARATOR);
        const subScopeKeys = Object.keys(scopedValues).filter((someScopeKey) =>
          scopeKeyInnerPairs.every((scopeKeyInnerPair) => someScopeKey.includes(scopeKeyInnerPair))
        );
        for (const subScopeKey of subScopeKeys) {
          Reflect.deleteProperty(scopedValues, subScopeKey);
        }
      }

      if (newValue !== null) {
        scopedValues[scopeKey] = newValue;
      } else {
        if (Object.keys(scopedValues).length > 1) {
          Reflect.deleteProperty(scopedValues, scopeKey);
        } else {
          return null;
        }
      }
      return scopedValues;
    } else {
      if (newValue !== null) {
        return { [scopeKey]: newValue };
      } else {
        return null;
      }
    }
  }

  // NOTE: stateScopedValues needs to be at least an empty object {}
  static _updateStateScopedValuesInPlace(stateScopedValues, key, newValue, scopeKey, options) {
    const scopedValues = this._updateScopedValues(stateScopedValues[key], newValue, scopeKey, options);
    if (scopedValues !== null) {
      stateScopedValues[key] = scopedValues;
    } else {
      Reflect.deleteProperty(stateScopedValues, key);
    }
  }

  /**
   * @typedef ChangeOptions
   * ChangeOptions are extra options to control a change to a feature toggle value. For now, there is only one option
   *
   * Example:
   *   { clearSubScopes: true }
   *
   * @type object
   * @property {boolean}  [clearSubScopes]  switch to clear all sub scopes, defaults to false
   */
  /**
   * @typedef ChangeEntry
   * ChangeEntry represents a single value change related to a feature key and an optional scopeMap. Setting newValue
   * to null means delete the value. Omitting the scopeMap changes the root scope.
   *
   * Example:
   *   const FEATURE_VALUE_KEY = "/server/part_x/feature_y"
   *   { key: FEATURE_VALUE_KEY, newValue: true },
   *   { key: FEATURE_VALUE_KEY, newValue: true, scopeMap: { tenant: "t1" } }
   *   { key: FEATURE_VALUE_KEY, newValue: null, options: { clearSubScopes: true } }
   *
   * @type object
   * @property {string}                      key               feature key
   * @property {string|number|boolean|null}  newValue          feature value after change
   * @property {Map<string, string>}         [scopeMap]        optional scope tags to where the change applies
   * @property {ChangeOptions}               [options]         optional change options
   */
  /**
   * @param {Array<ChangeEntry>} entries
   */
  static _serializeChangesToRefreshMessage(entries) {
    return JSON.stringify(entries);
  }

  /**
   * @returns {Array<ChangeEntry>}
   */
  static _deserializeChangesFromRefreshMessage(message) {
    return JSON.parse(message);
  }

  /**
   * Refresh local feature values from redis. This will only refresh the local state and not trigger change handlers.
   */
  // NOTE: refresh used to trigger the change handlers, but with scoping keeping this feature would become really messy.
  // From the state difference, there is no good way to infer the actual scopeMap and options that were used. You would
  // also have to trigger changes for any small scope-level change leading to lots of callbacks.
  async refreshFeatureValues() {
    this._ensureInitialized();
    try {
      const newStateScopedValues = await redisGetObject(this.__featuresKey);
      if (!newStateScopedValues) {
        return;
      }

      const [validatedNewStateRaw, validationErrors] = await this._validateStateScopedValues(newStateScopedValues);
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
      const validatedNewStateScopedValues = validatedNewStateRaw ?? {};
      this.__stateScopedValues = validatedNewStateScopedValues;
    } catch (err) {
      logger.error(new VError({ name: VERROR_CLUSTER_NAME, cause: err }, "error during refresh feature values"));
    }
  }

  async _triggerChangeHandlers(key, oldValue, newValue, scopeMap, options) {
    if (oldValue === newValue) {
      return;
    }

    const changeHandlers = this.__featureValueChangeHandlers.getHandlers(key);
    if (changeHandlers.length === 0) {
      return;
    }

    await Promise.all(
      changeHandlers.map(async (changeHandler) => {
        try {
          return await changeHandler(newValue, oldValue, scopeMap, options);
        } catch (err) {
          logger.error(
            new VError(
              {
                name: VERROR_CLUSTER_NAME,
                cause: err,
                info: {
                  changeHandler: changeHandler.name || "anonymous",
                  key,
                },
              },
              "error during feature value change handler"
            )
          );
        }
      })
    );
  }

  /**
   * Handler for refresh message.
   */
  async _messageHandler(message) {
    let key, newValue, scopeMap, options;
    try {
      const changeEntries = FeatureToggles._deserializeChangesFromRefreshMessage(message);
      await promiseAllDone(
        changeEntries.map(async (changeEntry) => {
          ({ key, newValue, scopeMap, options } = changeEntry);

          const scopeKey = FeatureToggles.getScopeKey(scopeMap);
          const oldValue = FeatureToggles._getFeatureValueForScopeAndStateAndFallback(
            this.__superScopeCache,
            this.__stateScopedValues,
            this.__fallbackValues,
            key,
            scopeMap
          );

          const validationErrors = await this.validateFeatureValue(key, newValue, scopeKey);
          if (Array.isArray(validationErrors) && validationErrors.length > 0) {
            logger.warning(
              new VError(
                {
                  name: VERROR_CLUSTER_NAME,
                  info: {
                    validationErrors: JSON.stringify(validationErrors),
                  },
                },
                "received and ignored invalid value from message"
              )
            );
            return;
          }

          await this._triggerChangeHandlers(key, oldValue, newValue, scopeMap, options);
          FeatureToggles._updateStateScopedValuesInPlace(this.__stateScopedValues, key, newValue, scopeKey, options);
        })
      );
    } catch (err) {
      logger.error(
        new VError(
          {
            name: VERROR_CLUSTER_NAME,
            cause: err,
            info: {
              channel: this.__featuresChannel,
              message,
              ...(key && { key }),
              ...(scopeMap && { scopeMap: JSON.stringify(scopeMap) }),
            },
          },
          "error during message handling"
        )
      );
    }
  }

  async _changeRemoteFeatureValue(key, newValue, scopeMap, options) {
    const scopeKey = FeatureToggles.getScopeKey(scopeMap);
    const validationErrors = await this.validateFeatureValue(key, newValue, scopeKey);
    if (Array.isArray(validationErrors) && validationErrors.length > 0) {
      return validationErrors;
    }

    const newRedisStateCallback = (scopedValues) =>
      FeatureToggles._updateScopedValues(scopedValues, newValue, scopeKey, options);
    try {
      await redisWatchedHashGetSetObject(this.__featuresKey, key, newRedisStateCallback);
      // NOTE: it would be possible to pass along the scopeKey here as well, but really it can be efficiently computed
      // from the scopeMap by the receiver, so we leave it out here.
      const changeEntry = { key, newValue, ...(scopeMap && { scopeMap }), ...(options && { options }) };
      await publishMessage(this.__featuresChannel, FeatureToggles._serializeChangesToRefreshMessage([changeEntry]));
    } catch (err) {
      logger.warning(
        isOnCF
          ? new VError(
              {
                name: VERROR_CLUSTER_NAME,
                cause: err,
                info: {
                  key,
                  newValue,
                  ...(scopeMap && { scopeMap: JSON.stringify(scopeMap) }),
                  ...(options && { options: JSON.stringify(options) }),
                },
              },
              "error during change remote feature values, switching to local update"
            )
          : "error during change remote feature values, switching to local update"
      );
      const oldValue = FeatureToggles._getFeatureValueForScopeAndStateAndFallback(
        this.__superScopeCache,
        this.__stateScopedValues,
        this.__fallbackValues,
        key,
        scopeMap
      );

      // NOTE: in local mode, it makes no sense to validate newValue again
      await this._triggerChangeHandlers(key, oldValue, newValue, scopeMap, options);
      FeatureToggles._updateStateScopedValuesInPlace(this.__stateScopedValues, key, newValue, scopeKey, options);
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
   *   await changeFeatureValue(FEATURE_VALUE_KEY, "newValForTenant", { tenantId: "tenant123"});
   *
   * @param {string}                      key         valid feature key
   * @param {string|number|boolean|null}  newValue    new value of valid type or null for deletion
   * @param {Map<string, string>}         [scopeMap]  optional object with scope restrictions
   * @param {ChangeOptions}               [options]   optional extra change options
   * @returns {Promise<Array<ValidationError> | void>}
   */
  async changeFeatureValue(key, newValue, scopeMap = undefined, options = undefined) {
    this._ensureInitialized();
    return await this._changeRemoteFeatureValue(key, newValue, scopeMap, options);
  }

  async resetFeatureValue(key) {
    this._ensureInitialized();
    return await this._changeRemoteFeatureValue(key, null, undefined, { clearSubScopes: true });
  }

  // ========================================
  // END OF CHANGE_FEATURE_VALUE SECTION
  // ========================================
  // ========================================
  // START OF FEATURE_VALUE_CHANGE_HANDLER SECTION
  // ========================================

  /**
   * @callback ChangeHandler
   *
   * The change handler gets the new value as well as the old value, immediately after the update is propagated.
   *
   * @param {boolean | number | string | null}  newValue
   * @param {boolean | number | string}         oldValue
   * @param {Map<string, string>}               [scopeMap]        optional value in case a scopeMap
   * @param {ChangeOptions}                     [options]  optional switch to clear all sub scopes
   */
  /**
   * Register given handler to receive changes of given feature value key.
   * Errors happening during handler execution will be caught and logged.
   *
   * @param {string}         key
   * @param {ChangeHandler}  changeHandler
   */
  registerFeatureValueChangeHandler(key, changeHandler) {
    this.__featureValueChangeHandlers.registerHandler(key, changeHandler);
  }

  /**
   * Stop given handler from receiving changes of given feature value key.
   *
   * @param {string}         key
   * @param {ChangeHandler}  changeHandler
   */
  removeFeatureValueChangeHandler(key, changeHandler) {
    this.__featureValueChangeHandlers.removeHandler(key, changeHandler);
  }

  /**
   * Stop all handlers from receiving changes of given feature value key.
   *
   * @param {string} key
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
   * @callback Validator
   *
   * The validator gets the new value and can do any number of checks on it. Returning anything falsy, like undefined,
   * means the new value passes validation, otherwise the validator must return either a single {@link ValidationError},
   * or a list of ValidationErrors.
   *
   * @param {boolean | number | string}  newValue
   * @param {string}                     [scopeKey]  optional scopeKey for reference
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
   * @param {string}     key
   * @param {Validator}  validator
   */
  registerFeatureValueValidation(key, validator) {
    this.__featureValueValidators.registerHandler(key, validator);
  }

  /**
   * Stop given validation for a given feature value key.
   *
   * @param {string}     key
   * @param {Validator}  validator
   */
  removeFeatureValueValidation(key, validator) {
    this.__featureValueValidators.removeHandler(key, validator);
  }

  /**
   * Stop all validation for a given feature value key.
   *
   * @param {string}  key
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
  SCOPE_ROOT_KEY,

  _: {
    _getLogger: () => logger,
    _setLogger: (value) => (logger = value),
  },
};
