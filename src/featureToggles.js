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

// TODO locale for validation messages
// TODO document clearSubScopes option

const { promisify } = require("util");
const path = require("path");
const { readFile } = require("fs");
const VError = require("verror");
const yaml = require("yaml");
const redis = require("./redisWrapper");
const { REDIS_INTEGRATION_MODE } = redis;
const { Logger } = require("./logger");
const { isOnCF, cfEnv } = require("./env");
const { HandlerCollection } = require("./shared/handlerCollection");
const { ENV, isObject, tryRequire } = require("./shared/static");
const { promiseAllDone } = require("./shared/promiseAllDone");
const { LimitedLazyCache } = require("./shared/cache");

const ENV_UNIQUE_NAME = process.env[ENV.UNIQUE_NAME];
const DEFAULT_REDIS_CHANNEL = process.env[ENV.REDIS_CHANNEL] || "features";
const DEFAULT_REDIS_KEY = process.env[ENV.REDIS_KEY] || "features";
const DEFAULT_CONFIG_FILEPATH = path.join(process.cwd(), ".featuretogglesrc.yml");
const FEATURE_VALID_TYPES = ["string", "number", "boolean"];

const SUPER_SCOPE_CACHE_SIZE_LIMIT = 15;
const SCOPE_KEY_INNER_SEPARATOR = "::";
const SCOPE_KEY_OUTER_SEPARATOR = "##";
const SCOPE_ROOT_KEY = "//";

const CONFIG_KEY = Object.freeze({
  TYPE: "TYPE",
  ACTIVE: "ACTIVE",
  APP_URL: "APP_URL",
  APP_URL_ACTIVE: "APP_URL_ACTIVE",
  FAILING_APP_URL_REGEX: "FAILING_APP_URL_REGEX",
  VALIDATIONS: "VALIDATIONS",
  VALIDATIONS_SCOPES_MAP: "VALIDATIONS_SCOPES_MAP",
  VALIDATIONS_REGEX: "VALIDATIONS_REGEX",
});

const CONFIG_INFO_KEY = {
  [CONFIG_KEY.TYPE]: true,
  [CONFIG_KEY.ACTIVE]: true,
  [CONFIG_KEY.APP_URL]: true,
  [CONFIG_KEY.APP_URL_ACTIVE]: true,
  [CONFIG_KEY.VALIDATIONS]: true,
};

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
let logger = new Logger(COMPONENT_NAME);

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

  _processValidations(featureKey, validations, configFilepath) {
    const workingDir = process.cwd();
    const configDir = configFilepath ? path.dirname(configFilepath) : __dirname;

    const validationsScopesMap = {};
    const validationsRegex = [];
    const validationsCode = [];
    for (const validation of validations) {
      if (Array.isArray(validation.scopes)) {
        for (const scope of validation.scopes) {
          validationsScopesMap[scope] = true;
        }
        continue;
      }

      if (validation.regex) {
        validationsRegex.push(new RegExp(validation.regex));
        continue;
      }

      if (validation.module) {
        let modulePath = validation.module.replace("$CONFIG_DIR", configDir);
        if (!path.isAbsolute(modulePath)) {
          modulePath = path.join(workingDir, modulePath);
        }
        let validator = tryRequire(modulePath);

        if (validation.call) {
          validator = validator?.[validation.call];
        }

        const validatorType = typeof validator;
        if (validatorType === "function") {
          validationsCode.push(validator);
        } else {
          logger.warning(
            new VError(
              {
                name: VERROR_CLUSTER_NAME,
                info: {
                  featureKey,
                  validation: JSON.stringify(validation),
                  modulePath,
                  validatorType,
                },
              },
              "could not load module validation"
            )
          );
        }
        continue;
      }

      throw new VError(
        {
          name: VERROR_CLUSTER_NAME,
          info: {
            featureKey,
            validation: JSON.stringify(validation),
          },
        },
        "found invalid validation"
      );
    }

    if (Object.keys(validationsScopesMap).length > 0) {
      this.__config[featureKey][CONFIG_KEY.VALIDATIONS_SCOPES_MAP] = validationsScopesMap;
    }
    if (validationsRegex.length > 0) {
      this.__config[featureKey][CONFIG_KEY.VALIDATIONS_REGEX] = validationsRegex;
    }
    for (const validator of validationsCode) {
      this.registerFeatureValueValidation(featureKey, validator);
    }
  }

  /**
   * Populate this.__config.
   */
  _processConfig(config, configFilepath) {
    const { uris: cfAppUris } = cfEnv.cfApp;
    const configEntries = Object.entries(config);
    for (const [featureKey, { type, active, appUrl, fallbackValue, validations }] of configEntries) {
      this.__featureKeys.push(featureKey);
      this.__fallbackValues[featureKey] = fallbackValue;
      this.__config[featureKey] = {};

      if (type) {
        this.__config[featureKey][CONFIG_KEY.TYPE] = type;
      }

      if (active === false) {
        this.__config[featureKey][CONFIG_KEY.ACTIVE] = false;
      }

      if (appUrl) {
        this.__config[featureKey][CONFIG_KEY.APP_URL] = appUrl;
        const appUrlRegex = new RegExp(appUrl);
        if (Array.isArray(cfAppUris) && cfAppUris.every((cfAppUri) => !appUrlRegex.test(cfAppUri))) {
          this.__config[featureKey][CONFIG_KEY.APP_URL_ACTIVE] = false;
          this.__config[featureKey][CONFIG_KEY.FAILING_APP_URL_REGEX] = appUrlRegex;
        }
      }

      if (validations) {
        this.__config[featureKey][CONFIG_KEY.VALIDATIONS] = validations;
        this._processValidations(featureKey, validations, configFilepath);
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

  _reset({ uniqueName, redisChannel, redisKey }) {
    this.__redisChannel = uniqueName ? redisChannel + "-" + uniqueName : redisChannel;
    this.__redisKey = uniqueName ? redisKey + "-" + uniqueName : redisKey;

    this.__featureValueChangeHandlers = new HandlerCollection();
    this.__featureValueValidators = new HandlerCollection();
    this.__messageHandler = this._messageHandler.bind(this); // needed for testing
    this.__superScopeCache = new LimitedLazyCache({ sizeLimit: SUPER_SCOPE_CACHE_SIZE_LIMIT });

    this.__config = {};
    this.__featureKeys = [];
    this.__fallbackValues = {};
    this.__stateScopedValues = {};
    this.__isInitialized = false;
    this.__isConfigProcessed = false;
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
  constructor({ uniqueName = undefined, redisChannel = DEFAULT_REDIS_CHANNEL, redisKey = DEFAULT_REDIS_KEY } = {}) {
    this._reset({ uniqueName, redisChannel, redisKey });
  }

  // ========================================
  // END OF CONSTRUCTOR SECTION
  // ========================================
  // ========================================
  // START OF SINGLETON SECTION
  // ========================================

  static _getInstanceUniqueName() {
    if (ENV_UNIQUE_NAME) {
      return ENV_UNIQUE_NAME;
    }
    let cfApp;
    try {
      cfApp = cfEnv.cfApp;
      if (cfApp.application_name) {
        return cfApp.application_name;
      }
    } catch (err) {
      throw new VError(
        {
          name: VERROR_CLUSTER_NAME,
          cause: err,
          info: {
            cfApp: JSON.stringify(cfApp),
          },
        },
        "error determining cf app name"
      );
    }
  }

  /**
   * Get singleton instance
   *
   * @return FeatureToggles
   */
  static getInstance() {
    if (!FeatureToggles.__instance) {
      const uniqueName = FeatureToggles._getInstanceUniqueName();
      FeatureToggles.__instance = new FeatureToggles({ uniqueName });
    }
    return FeatureToggles.__instance;
  }

  // ========================================
  // END OF SINGLETON SECTION
  // ========================================
  // ========================================
  // START OF VALIDATION SECTION
  // ========================================

  static _isValidFeatureKey(fallbackValues, featureKey) {
    return typeof featureKey === "string" && Object.prototype.hasOwnProperty.call(fallbackValues, featureKey);
  }

  static _isValidFeatureValueType(value) {
    return value === null || FEATURE_VALID_TYPES.includes(typeof value);
  }

  static _isValidScopeKey(scopeKey) {
    return scopeKey === undefined || typeof scopeKey === "string";
  }

  // NOTE: this function is used during initialization, so we cannot check this.__isInitialized
  async _validateFeatureValue(featureKey, value, scopeMap, scopeKey) {
    if (!this.__isConfigProcessed) {
      return [{ errorMessage: "not initialized" }];
    }

    if (!FeatureToggles._isValidFeatureKey(this.__fallbackValues, featureKey)) {
      return [{ featureKey, errorMessage: "feature key is not valid" }];
    }

    if (scopeMap !== undefined) {
      if (!isObject(scopeMap)) {
        return [
          {
            featureKey,
            errorMessage: "scopeMap must be undefined or an object",
          },
        ];
      }
      const validationsScopesMap = this.__config[featureKey][CONFIG_KEY.VALIDATIONS_SCOPES_MAP];
      for (const [scope, value] of Object.entries(scopeMap)) {
        if (!FeatureToggles._isValidScopeMapValue(value)) {
          return [
            {
              featureKey,
              errorMessage: 'scope "{0}" has invalid type {1}, must be string',
              errorMessageValues: [scope, typeof value],
            },
          ];
        }
        if (validationsScopesMap && !validationsScopesMap[scope]) {
          return [
            {
              featureKey,
              errorMessage: 'scope "{0}" is not allowed',
              errorMessageValues: [scope],
            },
          ];
        }
      }
    }

    if (!FeatureToggles._isValidScopeKey(scopeKey)) {
      return [{ featureKey, scopeKey, errorMessage: "scopeKey is not valid" }];
    }

    // NOTE: value === null is our way of encoding featureKey resetting changes, so it is always allowed
    if (value === null) {
      return [];
    }

    // NOTE: skip validating active properties during initialization
    if (this.__isInitialized) {
      if (this.__config[featureKey][CONFIG_KEY.ACTIVE] === false) {
        return [{ featureKey, errorMessage: "feature key is not active" }];
      }

      if (this.__config[featureKey][CONFIG_KEY.APP_URL_ACTIVE] === false) {
        const failingAppUrlRegex = this.__config[featureKey][CONFIG_KEY.FAILING_APP_URL_REGEX];
        return [
          {
            featureKey,
            errorMessage: "feature key is not active because app url does not match regular expression {0}",
            errorMessageValues: [failingAppUrlRegex.toString()],
          },
        ];
      }
    }

    const valueType = typeof value;
    if (!FeatureToggles._isValidFeatureValueType(value)) {
      return [
        {
          featureKey,
          ...(scopeKey && { scopeKey }),
          errorMessage: 'value "{0}" has invalid type {1}, must be in {2}',
          errorMessageValues: [value, valueType, FEATURE_VALID_TYPES],
        },
      ];
    }

    if (valueType !== this.__config[featureKey][CONFIG_KEY.TYPE]) {
      return [
        {
          featureKey,
          ...(scopeKey && { scopeKey }),
          errorMessage: 'value "{0}" has invalid type {1}, must be {2}',
          errorMessageValues: [value, valueType, this.__config[featureKey][CONFIG_KEY.TYPE]],
        },
      ];
    }

    const validationsRegex = this.__config[featureKey][CONFIG_KEY.VALIDATIONS_REGEX];
    if (Array.isArray(validationsRegex) && validationsRegex.length > 0) {
      const failingRegex = validationsRegex.find((validationRegex) => !validationRegex.test(value));
      if (failingRegex) {
        return [
          {
            featureKey,
            ...(scopeKey && { scopeKey }),
            errorMessage: 'value "{0}" does not match validation regular expression {1}',
            errorMessageValues: [value, failingRegex.toString()],
          },
        ];
      }
    }

    const validators = this.__featureValueValidators.getHandlers(featureKey);
    if (validators.length === 0) {
      return [];
    }
    const validatorErrors = await Promise.all(
      validators.map(async (validator) => {
        const validatorName = validator.name || "anonymous";
        try {
          const validationErrorOrErrors = (await validator(value, scopeMap, scopeKey)) || [];
          const validationErrors = Array.isArray(validationErrorOrErrors)
            ? validationErrorOrErrors
            : [validationErrorOrErrors];
          return validationErrors.length > 0
            ? validationErrors
                .filter(({ errorMessage }) => errorMessage)
                .map(({ errorMessage, errorMessageValues }) => ({
                  featureKey,
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
                  featureKey,
                  ...(scopeKey && { scopeKey }),
                  value,
                },
              },
              "error during registered validator"
            )
          );
          return [
            {
              featureKey,
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
   * @typedef ValidationError
   * ValidationError must have a user-readable errorMessage. The message can use errorMessageValues, i.e., parameters
   * which are ignored for localization, but mixed in when the errorMessage is presented to the user.
   *
   * Example:
   *   { errorMessage: "got bad value" },
   *   { errorMessage: 'got bad value with parameter "{0}"', errorMessageValues: [paramFromValue(value)] }
   *
   * @type object
   * @property {string}         featureKey            feature toggle
   * @property {string}         errorMessage          user-readable error message
   * @property {Array<string>}  [errorMessageValues]  optional parameters for error message, which are ignored for localization
   */
  /**
   * Validate the value of a given featureKey, value pair. Allows passing an optional scopeMap that is added to
   * validationErrors for reference.
   *
   * @param {string}                      featureKey  feature key
   * @param {string|number|boolean|null}  value       intended value
   * @param {Map<string, string>}         [scopeMap]  optional scope restrictions
   * @returns {Promise<Array<ValidationError>>}       validation errors if any are found or an empty array otherwise
   */
  async validateFeatureValue(featureKey, value, scopeMap = undefined) {
    return scopeMap === undefined
      ? await this._validateFeatureValue(featureKey, value)
      : await this._validateFeatureValue(featureKey, value, scopeMap, FeatureToggles.getScopeKey(scopeMap));
  }

  /**
   * Validate the fallback values. This will only return an array of validation errors, but not an object with
   * validated values, because fallback values are used even when they are invalid.
   */
  async _validateFallbackValues(fallbackValues) {
    let validationErrors = [];
    if (!isObject(fallbackValues)) {
      return validationErrors;
    }

    for (const [featureKey, value] of Object.entries(fallbackValues)) {
      const entryValidationErrors = await this._validateFeatureValue(featureKey, value);
      if (Array.isArray(entryValidationErrors) && entryValidationErrors.length > 0) {
        validationErrors = validationErrors.concat(entryValidationErrors);
      }
    }
    return validationErrors;
  }

  async _validateScopedValues(featureKey, scopedValues) {
    let validationErrors = [];
    let validatedStateScopedValues = {};

    for (const [scopeKey, value] of Object.entries(scopedValues)) {
      const entryValidationErrors = await this._validateFeatureValue(
        featureKey,
        value,
        FeatureToggles.getScopeMap(scopeKey),
        scopeKey
      );
      let updateValue = value;
      if (Array.isArray(entryValidationErrors) && entryValidationErrors.length > 0) {
        validationErrors = validationErrors.concat(entryValidationErrors);
        updateValue = null;
      }
      FeatureToggles._updateStateScopedValuesOneScopeInPlace(
        validatedStateScopedValues,
        featureKey,
        updateValue,
        scopeKey
      );
    }

    const validatedScopedValues = Object.prototype.hasOwnProperty.call(validatedStateScopedValues, featureKey)
      ? validatedStateScopedValues[featureKey]
      : null;
    return [validatedScopedValues, validationErrors];
  }

  // ========================================
  // END OF VALIDATION SECTION
  // ========================================
  // ========================================
  // START OF INITIALIZE SECTION
  // ========================================

  _isKeyActive(featureKey) {
    return (
      this.__config[featureKey][CONFIG_KEY.ACTIVE] !== false &&
      this.__config[featureKey][CONFIG_KEY.APP_URL_ACTIVE] !== false
    );
  }

  async _freshStateScopedValues() {
    return await this.__featureKeys.reduce(
      async (acc, featureKey) => {
        let [validatedStateScopedValues, validationErrors] = await acc;
        if (this._isKeyActive(featureKey)) {
          const validatedScopedValues = await redis.watchedHashGetSetObject(
            this.__redisKey,
            featureKey,
            async (scopedValues) => {
              if (!isObject(scopedValues)) {
                return null;
              }
              const [validatedScopedValues, scopedValidationErrors] = await this._validateScopedValues(
                featureKey,
                scopedValues
              );
              validationErrors = validationErrors.concat(scopedValidationErrors);
              return validatedScopedValues;
            }
          );
          FeatureToggles._updateStateScopedValuesAllScopesInPlace(
            validatedStateScopedValues,
            featureKey,
            validatedScopedValues
          );
        }
        return [validatedStateScopedValues, validationErrors];
      },
      Promise.resolve([{}, []])
    );
  }

  async _migrateStringTypeState(stringTypeStateEntries) {
    let migrationCount = 0;
    for (const [featureKey, value] of stringTypeStateEntries) {
      if (
        !FeatureToggles._isValidFeatureKey(this.__fallbackValues, featureKey) ||
        this.__fallbackValues[featureKey] === value
      ) {
        continue;
      }
      try {
        const newRedisStateCallback = (scopedValues) =>
          FeatureToggles._updateScopedValuesInPlace(scopedValues, value, SCOPE_ROOT_KEY);
        await redis.watchedHashGetSetObject(this.__redisKey, featureKey, newRedisStateCallback);
        migrationCount++;
      } catch (err) {
        logger.error(
          new VError(
            {
              name: VERROR_CLUSTER_NAME,
              cause: err,
              info: {
                featureKey,
                value,
              },
            },
            "error during string type state migration"
          )
        );
      }
    }
    return migrationCount;
  }

  /**
   * Initialize needs to run and finish before other APIs are called. It processes the configuration, sets up
   * related internal state, and starts communication with redis.
   */
  async initializeFeatures({ config: configInput, configFile: configFilepath = DEFAULT_CONFIG_FILEPATH }) {
    if (this.__isInitialized) {
      return;
    }

    let config;
    try {
      config = configInput ? configInput : await readConfigFromFile(configFilepath);
    } catch (err) {
      throw new VError(
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
      );
    }

    let toggleCount;
    try {
      toggleCount = this._processConfig(config, configFilepath);
    } catch (err) {
      throw new VError(
        {
          name: VERROR_CLUSTER_NAME,
          cause: err,
          info: {
            ...(config && { config: JSON.stringify(config) }),
          },
        },
        "initialization aborted, could not process configuration"
      );
    }

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

    const redisIntegrationMode = await redis.getIntegrationMode();
    if (redisIntegrationMode !== REDIS_INTEGRATION_MODE.NO_REDIS) {
      try {
        // NOTE: in our legacy code the redisKey was a string
        let stringTypeStateEntries;
        const featureKeyType = await redis.type(this.__redisKey);
        if (featureKeyType === "string") {
          const stringTypeState = await redis.getObject(this.__redisKey);
          if (stringTypeState) {
            stringTypeStateEntries = Object.entries(stringTypeState);
            logger.info("found %i string type state entries", stringTypeStateEntries.length);
          }
        }
        if (featureKeyType !== "hash" && featureKeyType !== "none") {
          await redis.del(this.__redisKey);
          logger.info("removed legacy redis key of type: %s", featureKeyType);
        }
        if (stringTypeStateEntries) {
          // NOTE: this will write to the redisKey as a hash, so it needs to run after delete
          const migrationCount = await this._migrateStringTypeState(stringTypeStateEntries);
          logger.info("migrated %i string type state entries", migrationCount);
        }

        const [validatedStateScopedValues, validationErrors] = await this._freshStateScopedValues();
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
        this.__stateScopedValues = validatedStateScopedValues;

        redis.registerMessageHandler(this.__redisChannel, this.__messageHandler);
        await redis.subscribe(this.__redisChannel);
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
    }

    logger.info(
      "finished initialization with %i feature toggle%s with %s",
      toggleCount,
      toggleCount === 1 ? "" : "s",
      redisIntegrationMode
    );
    this.__isInitialized = true;
    return this;
  }

  // ========================================
  // END OF INITIALIZE SECTION
  // ========================================
  // ========================================
  // START OF GET_FEATURES_INFOS SECTION
  // ========================================

  static _getFeatureInfoConfig(config, featureKey) {
    return Object.entries(config[featureKey]).reduce((acc, [configKey, value]) => {
      if (CONFIG_INFO_KEY[configKey]) {
        acc[configKey] = value;
      }
      return acc;
    }, {});
  }

  _getFeatureInfo(featureKey) {
    let rootValue;
    let foundScopedValues = false;
    let scopedValues;
    if (this.__stateScopedValues[featureKey]) {
      scopedValues = Object.entries(this.__stateScopedValues[featureKey]).reduce((acc, [scopeKey, value]) => {
        if (scopeKey === SCOPE_ROOT_KEY) {
          rootValue = value;
        } else {
          foundScopedValues = true;
          acc[scopeKey] = value;
        }
        return acc;
      }, {});
    }

    return {
      fallbackValue: this.__fallbackValues[featureKey],
      ...(rootValue !== undefined && { rootValue }),
      ...(foundScopedValues && { scopedValues }),
      config: FeatureToggles._getFeatureInfoConfig(this.__config, featureKey),
    };
  }

  /**
   * Get feature info for specific featureKey.
   */
  getFeatureInfo(featureKey) {
    this._ensureInitialized();
    if (!FeatureToggles._isValidFeatureKey(this.__fallbackValues, featureKey)) {
      return null;
    }
    return this._getFeatureInfo(featureKey);
  }

  /**
   * Get feature infos for all featureKeys.
   */
  getFeaturesInfos() {
    this._ensureInitialized();
    return this.__featureKeys.reduce((acc, featureKey) => {
      acc[featureKey] = this._getFeatureInfo(featureKey);
      return acc;
    }, {});
  }

  // ========================================
  // END OF GET_FEATURES_INFOS SECTION
  // ========================================
  // ========================================
  // START OF GET_FEATURE_VALUE SECTION
  // ========================================

  static _isValidScopeMapValue(value) {
    return typeof value === "string";
  }

  /**
   * This is used to make sure scopeMap is either undefined or a shallow map with string entries. This happens for all
   * public interfaces with a scopeMap parameter, except {@link validateFeatureValue} and {@link changeFeatureValue}.
   * For these two interfaces, we want the "bad" scopeMaps to cause validation errors.
   * Also not for {@link getScopeKey}, where the sanitization must not happen in place.
   */
  static _sanitizeScopeMap(scopeMap) {
    if (!isObject(scopeMap)) {
      return undefined;
    }
    for (const [scope, value] of Object.entries(scopeMap)) {
      if (!FeatureToggles._isValidScopeMapValue(value)) {
        Reflect.deleteProperty(scopeMap, scope);
      }
    }
    return scopeMap;
  }

  // NOTE: getScopeMap does the scopeMap sanitization on the fly, because it must not modify scopeMap in place.
  static getScopeKey(scopeMap) {
    if (!isObject(scopeMap)) {
      return SCOPE_ROOT_KEY;
    }
    const scopeMapKeys = Object.keys(scopeMap).filter((scope) => FeatureToggles._isValidScopeMapValue(scopeMap[scope]));
    if (scopeMapKeys.length === 0) {
      return SCOPE_ROOT_KEY;
    }
    return FeatureToggles._getNonRootScopeKey(scopeMap, scopeMapKeys.sort());
  }

  static _getNonRootScopeKey(scopeMap, sortedKeys) {
    return sortedKeys
      .map((scopeInnerKey) => scopeInnerKey + SCOPE_KEY_INNER_SEPARATOR + scopeMap[scopeInnerKey])
      .join(SCOPE_KEY_OUTER_SEPARATOR);
  }

  // NOTE: there are multiple scopeMaps for every scopeKey with more than one inner entry. This will return the unique
  // scopeMap whose keys are sorted, i.e., matching the keys in the scopeKey.
  static getScopeMap(scopeKey) {
    return !this._isValidScopeKey(scopeKey) || scopeKey === undefined || scopeKey === SCOPE_ROOT_KEY
      ? undefined
      : scopeKey.split(SCOPE_KEY_OUTER_SEPARATOR).reduce((acc, scopeInnerEntry) => {
          const [scopeInnerKey, value] = scopeInnerEntry.split(SCOPE_KEY_INNER_SEPARATOR);
          acc[scopeInnerKey] = value;
          return acc;
        }, {});
  }

  // NOTE: this does not return the scope root key, which is a super scope of every scope, because we handle this case
  // separately in _getFeatureValueForScopeAndStateAndFallback
  static _getNonRootSuperScopeKeys(superScopeCache, scopeMap) {
    const scopeMapKeys = Object.keys(scopeMap);

    const n = scopeMapKeys.length - 1;
    if (n === -1) {
      return [];
    }
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
    featureKey,
    scopeMap = undefined
  ) {
    const scopedValues = stateScopedValues[featureKey];
    const fallbackValue = fallbackValues[featureKey] ?? null;

    if (scopedValues === undefined) {
      return fallbackValue;
    }

    const scopeRootValue = scopedValues[SCOPE_ROOT_KEY] ?? fallbackValue;
    if (scopeMap === undefined) {
      return scopeRootValue;
    }

    for (const superScopeKey of FeatureToggles._getNonRootSuperScopeKeys(superScopeCache, scopeMap)) {
      const scopedValue = scopedValues[superScopeKey];
      if (scopedValue !== undefined) {
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
   *   const resultForTenant = getFeatureValue(FEATURE_VALUE_KEY, { tenant: "tenant123" });
   *
   * @param {string}               featureKey  valid feature key
   * @param {Map<string, string>}  [scopeMap]  optional scope restrictions
   * @returns {string|number|boolean|null}
   */
  getFeatureValue(featureKey, scopeMap = undefined) {
    this._ensureInitialized();
    scopeMap = FeatureToggles._sanitizeScopeMap(scopeMap);
    return FeatureToggles._getFeatureValueForScopeAndStateAndFallback(
      this.__superScopeCache,
      this.__stateScopedValues,
      this.__fallbackValues,
      featureKey,
      scopeMap
    );
  }

  // ========================================
  // END OF GET_FEATURE_VALUE SECTION
  // ========================================
  // ========================================
  // START OF CHANGE_FEATURE_VALUE SECTION
  // ========================================

  // NOTE: this function is modifying in place and also needs the caller to assign the return value to cover the
  //   deletion case. should be used sparingly, prefer _updateStateScopedValues*
  static _updateScopedValuesInPlace(
    scopedValues,
    newValue,
    scopeKey = SCOPE_ROOT_KEY,
    { clearSubScopes = false } = {}
  ) {
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
  static _updateStateScopedValuesAllScopesInPlace(stateScopedValues, featureKey, scopedValues) {
    if (scopedValues !== null) {
      stateScopedValues[featureKey] = scopedValues;
    } else {
      Reflect.deleteProperty(stateScopedValues, featureKey);
    }
  }

  // NOTE: stateScopedValues needs to be at least an empty object {}
  static _updateStateScopedValuesOneScopeInPlace(stateScopedValues, featureKey, newValue, scopeKey, options) {
    const scopedValues = FeatureToggles._updateScopedValuesInPlace(
      stateScopedValues[featureKey],
      newValue,
      scopeKey,
      options
    );
    FeatureToggles._updateStateScopedValuesAllScopesInPlace(stateScopedValues, featureKey, scopedValues);
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
   *   { featureKey: FEATURE_VALUE_KEY, newValue: true },
   *   { featureKey: FEATURE_VALUE_KEY, newValue: true, scopeMap: { tenant: "t1" } }
   *   { featureKey: FEATURE_VALUE_KEY, newValue: null, options: { clearSubScopes: true } }
   *
   * @type object
   * @property {string}                      featureKey        feature key
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
      const [validatedStateScopedValues, validationErrors] = await this._freshStateScopedValues();
      if (Array.isArray(validationErrors) && validationErrors.length > 0) {
        logger.warning(
          new VError(
            {
              name: VERROR_CLUSTER_NAME,
              info: { validationErrors: JSON.stringify(validationErrors) },
            },
            "removed invalid entries from redis during refresh"
          )
        );
      }
      this.__stateScopedValues = validatedStateScopedValues;
    } catch (err) {
      logger.error(new VError({ name: VERROR_CLUSTER_NAME, cause: err }, "error during refresh feature values"));
    }
  }

  async _triggerChangeHandlers(featureKey, oldValue, newValue, scopeMap, options) {
    if (oldValue === newValue) {
      return;
    }

    const changeHandlers = this.__featureValueChangeHandlers.getHandlers(featureKey);
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
                  featureKey,
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
    let featureKey, newValue, scopeMap, options;
    try {
      const changeEntries = FeatureToggles._deserializeChangesFromRefreshMessage(message);
      await promiseAllDone(
        changeEntries.map(async (changeEntry) => {
          ({ featureKey, newValue, scopeMap, options } = changeEntry);

          const scopeKey = FeatureToggles.getScopeKey(scopeMap);
          const oldValue = FeatureToggles._getFeatureValueForScopeAndStateAndFallback(
            this.__superScopeCache,
            this.__stateScopedValues,
            this.__fallbackValues,
            featureKey,
            scopeMap
          );

          const validationErrors = await this._validateFeatureValue(featureKey, newValue, scopeMap, scopeKey);
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

          await this._triggerChangeHandlers(featureKey, oldValue, newValue, scopeMap, options);
          FeatureToggles._updateStateScopedValuesOneScopeInPlace(
            this.__stateScopedValues,
            featureKey,
            newValue,
            scopeKey,
            options
          );
        })
      );
    } catch (err) {
      logger.error(
        new VError(
          {
            name: VERROR_CLUSTER_NAME,
            cause: err,
            info: {
              channel: this.__redisChannel,
              message,
              ...(featureKey && { featureKey }),
              ...(scopeMap && { scopeMap: JSON.stringify(scopeMap) }),
            },
          },
          "error during message handling"
        )
      );
    }
  }

  async _changeRemoteFeatureValue(featureKey, newValue, scopeMap, options) {
    const scopeKey = FeatureToggles.getScopeKey(scopeMap);
    const validationErrors = await this._validateFeatureValue(featureKey, newValue, scopeMap, scopeKey);
    if (Array.isArray(validationErrors) && validationErrors.length > 0) {
      return validationErrors;
    }

    const integrationMode = await redis.getIntegrationMode();
    // NOTE: for NO_REDIS mode, we just do a local update without further validation
    if (integrationMode === REDIS_INTEGRATION_MODE.NO_REDIS) {
      const oldValue = FeatureToggles._getFeatureValueForScopeAndStateAndFallback(
        this.__superScopeCache,
        this.__stateScopedValues,
        this.__fallbackValues,
        featureKey,
        scopeMap
      );
      await this._triggerChangeHandlers(featureKey, oldValue, newValue, scopeMap, options);
      FeatureToggles._updateStateScopedValuesOneScopeInPlace(
        this.__stateScopedValues,
        featureKey,
        newValue,
        scopeKey,
        options
      );
      return;
    }

    const newRedisStateCallback = (scopedValues) =>
      FeatureToggles._updateScopedValuesInPlace(scopedValues, newValue, scopeKey, options);
    try {
      await redis.watchedHashGetSetObject(this.__redisKey, featureKey, newRedisStateCallback);
      // NOTE: it would be possible to pass along the scopeKey here as well, but really it can be efficiently computed
      // from the scopeMap by the receiver, so we leave it out here.
      const changeEntry = { featureKey, newValue, ...(scopeMap && { scopeMap }), ...(options && { options }) };
      await redis.publishMessage(this.__redisChannel, FeatureToggles._serializeChangesToRefreshMessage([changeEntry]));
    } catch (err) {
      throw new VError(
        {
          name: VERROR_CLUSTER_NAME,
          cause: err,
          info: {
            featureKey,
            newValue,
            ...(scopeMap && { scopeMap: JSON.stringify(scopeMap) }),
            ...(options && { options: JSON.stringify(options) }),
          },
        },
        "error during change remote feature values"
      );
    }
  }

  /**
   * Remove or change a single feature value.
   *
   * Validation errors are returned in the form [{featureKey, errorMessage},...] if validation fails.
   *
   * Usage:
   *   const FEATURE_VALUE_KEY = "/server/part_x/feature_y"
   *   ...
   *   await changeFeatureValue(FEATURE_VALUE_KEY, "newVal");
   *   await changeFeatureValue(FEATURE_VALUE_KEY, "newValForTenant", { tenantId: "tenant123"});
   *
   * @param {string}                      featureKey  valid feature key
   * @param {string|number|boolean|null}  newValue    new value of valid type or null for deletion
   * @param {Map<string, string>}         [scopeMap]  optional object with scope restrictions
   * @param {ChangeOptions}               [options]   optional extra change options
   * @returns {Promise<Array<ValidationError> | void>}
   */
  async changeFeatureValue(featureKey, newValue, scopeMap = undefined, options = undefined) {
    this._ensureInitialized();
    return await this._changeRemoteFeatureValue(featureKey, newValue, scopeMap, options);
  }

  async resetFeatureValue(featureKey) {
    this._ensureInitialized();
    return await this._changeRemoteFeatureValue(featureKey, null, undefined, { clearSubScopes: true });
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
   * @param {Map<string, string>}               [scopeMap]  optional value in case a scopeMap
   * @param {ChangeOptions}                     [options]   optional switch to clear all sub scopes
   */
  /**
   * Register given handler to receive changes of given feature value key.
   * Errors happening during handler execution will be caught and logged.
   *
   * @param {string}         featureKey
   * @param {ChangeHandler}  changeHandler
   */
  registerFeatureValueChangeHandler(featureKey, changeHandler) {
    this.__featureValueChangeHandlers.registerHandler(featureKey, changeHandler);
  }

  /**
   * Stop given handler from receiving changes of given feature value key.
   *
   * @param {string}         featureKey
   * @param {ChangeHandler}  changeHandler
   */
  removeFeatureValueChangeHandler(featureKey, changeHandler) {
    this.__featureValueChangeHandlers.removeHandler(featureKey, changeHandler);
  }

  /**
   * Stop all handlers from receiving changes of given feature value key.
   *
   * @param {string} featureKey
   */
  removeAllFeatureValueChangeHandlers(featureKey) {
    this.__featureValueChangeHandlers.removeAllHandlers(featureKey);
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
   * or a list of ValidationErrors. The validator will receive either no scoping information or both the scopeMap and
   * scopeKey for reference.
   *
   * @param {boolean | number | string}  newValue
   * @param {Map<string, string>}        [scopeMap]  optional scopeMap for reference
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
   * registerFeatureValueValidation(featureKey, (newValue) => {
   *   if (isBad(newValue)) {
   *     return { errorMessage: "got bad value" };
   *   }
   *   if (isWorse(newValue)) {
   *     return { errorMessage: 'got bad value with parameter "{0}"', errorMessageValues: [paramFromValue(value)] };
   *   }
   * });
   *
   * @param {string}     featureKey
   * @param {Validator}  validator
   */
  registerFeatureValueValidation(featureKey, validator) {
    this.__featureValueValidators.registerHandler(featureKey, validator);
  }

  /**
   * Stop given validation for a given feature value key.
   *
   * @param {string}     featureKey
   * @param {Validator}  validator
   */
  removeFeatureValueValidation(featureKey, validator) {
    this.__featureValueValidators.removeHandler(featureKey, validator);
  }

  /**
   * Stop all validation for a given feature value key.
   *
   * @param {string}  featureKey
   */
  removeAllFeatureValueValidation(featureKey) {
    this.__featureValueValidators.removeAllHandlers(featureKey);
  }

  // ========================================
  // END OF FEATURE_VALUE_EXTERNAL_VALIDATION SECTION
  // ========================================
}

module.exports = {
  SCOPE_ROOT_KEY,
  FeatureToggles,
  readConfigFromFile,

  _: {
    CONFIG_KEY,
    CONFIG_INFO_KEY,
    _getLogger: () => logger,
    _setLogger: (value) => (logger = value),
  },
};
