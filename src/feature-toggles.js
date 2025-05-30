/**
 * SAP BTP Feature Toggle Library
 *
 * {@link https://cap-js-community.github.io/feature-toggle-library/ Documentation}
 *
 * important usage functions:
 * @see FeatureToggles#getFeatureValue
 * @see FeatureToggles#changeFeatureValue
 * @see FeatureToggles#registerFeatureValueChangeHandler
 */
"use strict";

// TODO locale for validation messages

const util = require("util");
const pathlib = require("path");
const fs = require("fs");
const VError = require("verror");
const yaml = require("yaml");
const redis = require("./redis-adapter");
const { REDIS_INTEGRATION_MODE } = redis;
const { CfEnv } = require("./shared/cf-env");
const { Logger } = require("./shared/logger");
const { HandlerCollection } = require("./shared/handler-collection");
const { LimitedLazyCache } = require("./shared/cache");
const { isObject, tryRequire, tryPathReadable, tryJsonParse } = require("./shared/static");

const ENV = Object.freeze({
  UNIQUE_NAME: "BTP_FEATURES_UNIQUE_NAME",
  REDIS_KEY: "BTP_FEATURES_REDIS_KEY",
  REDIS_CHANNEL: "BTP_FEATURES_REDIS_CHANNEL",
});

const ENV_UNIQUE_NAME = process.env[ENV.UNIQUE_NAME];
const DEFAULT_REDIS_CHANNEL = process.env[ENV.REDIS_CHANNEL] || "features";
const DEFAULT_REDIS_KEY = process.env[ENV.REDIS_KEY] || "features";
const DEFAULT_CONFIG_FILEPATH = pathlib.join(process.cwd(), ".features.yaml");
const FEATURE_VALID_TYPES = ["string", "number", "boolean"];

const SUPER_SCOPE_CACHE_SIZE_LIMIT = 15;
const SCOPE_KEY_INNER_SEPARATOR = "::";
const SCOPE_KEY_OUTER_SEPARATOR = "##";
const SCOPE_ROOT_KEY = "//";

const CONFIG_SOURCE = Object.freeze({
  NONE: "NONE", // for toggles that are not configured
  RUNTIME: "RUNTIME",
  FILE: "FILE",
  AUTO: "AUTO",
});

const CONFIG_MERGE_CONFLICT = Object.freeze({
  THROW: "THROW",
  PRESERVE: "PRESERVE",
  OVERRIDE: "OVERRIDE",
});

const CONFIG_KEY = Object.freeze({
  TYPE: "TYPE",
  ACTIVE: "ACTIVE",
  SOURCE: "SOURCE",
  SOURCE_FILEPATH: "SOURCE_FILEPATH",
  APP_URL: "APP_URL",
  APP_URL_ACTIVE: "APP_URL_ACTIVE",
  VALIDATIONS: "VALIDATIONS",
  VALIDATIONS_SCOPES_MAP: "VALIDATIONS_SCOPES_MAP",
  VALIDATIONS_REGEX: "VALIDATIONS_REGEX",
});

const CONFIG_INFO_KEY = {
  [CONFIG_KEY.TYPE]: true,
  [CONFIG_KEY.ACTIVE]: true,
  [CONFIG_KEY.SOURCE]: true,
  [CONFIG_KEY.SOURCE_FILEPATH]: true,
  [CONFIG_KEY.APP_URL]: true,
  [CONFIG_KEY.APP_URL_ACTIVE]: true,
  [CONFIG_KEY.VALIDATIONS]: true,
};

const COMPONENT_NAME = "/FeatureToggles";
const VERROR_CLUSTER_NAME = "FeatureTogglesError";

const SCOPE_PREFERENCE_ORDER_MASKS = [
  [
    // choose 1 of 2
    parseInt("10", 2),
    parseInt("01", 2),
  ],
  [
    // choose 2 of 3
    parseInt("110", 2),
    parseInt("101", 2),
    parseInt("011", 2),

    // choose 1 of 3
    parseInt("100", 2),
    parseInt("010", 2),
    parseInt("001", 2),
  ],
  [
    // choose 3 of 4
    parseInt("1110", 2),
    parseInt("1101", 2),
    parseInt("1011", 2),
    parseInt("0111", 2),

    // choose 2 of 4
    parseInt("1100", 2),
    parseInt("1010", 2),
    parseInt("1001", 2),
    parseInt("0110", 2),
    parseInt("0101", 2),
    parseInt("0011", 2),

    // choose 1 of 4
    parseInt("1000", 2),
    parseInt("0100", 2),
    parseInt("0010", 2),
    parseInt("0001", 2),
  ],
];

const cfEnv = CfEnv.getInstance();
const readFileAsync = util.promisify(fs.readFile);
let logger = new Logger(COMPONENT_NAME);

/**
 * FeatureToggles main library API class.
 */
class FeatureToggles {
  static __instance;

  // ========================================
  // START OF CONSTRUCTOR SECTION
  // ========================================

  static _getDefaultUniqueName() {
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

  _processValidations(featureKey, validations, configFilepath) {
    const configDir = configFilepath ? pathlib.dirname(configFilepath) : process.cwd();

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
        const modulePath = validation.module.replace("$CONFIG_DIR", configDir);
        const validatorModule = tryRequire(pathlib.resolve(modulePath));
        const validator = validation.call ? validatorModule?.[validation.call] : validatorModule;

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

  _processConfigSource(source, mergeConflictBehavior, configFromSource, sourceFilepath) {
    let count = 0;
    if (!isObject(configFromSource)) {
      return count;
    }

    const { uris: cfAppUris } = cfEnv.cfApp;
    const entries = Object.entries(configFromSource);
    for (const [featureKey, value] of entries) {
      if (this.__config[featureKey]) {
        switch (mergeConflictBehavior) {
          case CONFIG_MERGE_CONFLICT.OVERRIDE: {
            break;
          }
          case CONFIG_MERGE_CONFLICT.PRESERVE: {
            continue;
          }
          case CONFIG_MERGE_CONFLICT.THROW: // eslint-disable-current-line no-fallthrough
          default: {
            const sourceExisting = this.__config[featureKey][CONFIG_KEY.SOURCE];
            const sourceConflicting = source;
            const sourceFilepathExisting = this.__config[featureKey][CONFIG_KEY.SOURCE_FILEPATH];
            const sourceFilepathConflicting = sourceFilepath;
            throw new VError(
              {
                name: VERROR_CLUSTER_NAME,
                info: {
                  featureKey,
                  sourceExisting,
                  sourceConflicting,
                  ...(sourceFilepathExisting && { sourceFilepathExisting }),
                  ...(sourceFilepathConflicting && { sourceFilepathConflicting }),
                },
              },
              "feature is configured twice"
            );
          }
        }
      }
      count++;

      if (!isObject(value)) {
        throw new VError(
          {
            name: VERROR_CLUSTER_NAME,
            info: {
              featureKey,
              source,
              ...(sourceFilepath && { sourceFilepath }),
            },
          },
          "configuration is not an object"
        );
      }

      const { type, active, appUrl, fallbackValue, validations } = value;

      if ([undefined, null].includes(fallbackValue)) {
        throw new VError(
          {
            name: VERROR_CLUSTER_NAME,
            info: {
              featureKey,
              source,
              ...(sourceFilepath && { sourceFilepath }),
            },
          },
          "configuration has no or invalid fallback value"
        );
      }

      if (!FEATURE_VALID_TYPES.includes(type)) {
        throw new VError(
          {
            name: VERROR_CLUSTER_NAME,
            info: {
              featureKey,
              source,
              ...(sourceFilepath && { sourceFilepath }),
            },
          },
          "configuration has no or invalid type"
        );
      }

      this.__fallbackValues[featureKey] = fallbackValue;
      this.__config[featureKey] = {};

      this.__config[featureKey][CONFIG_KEY.TYPE] = type;

      this.__config[featureKey][CONFIG_KEY.SOURCE] = source;

      if (sourceFilepath) {
        this.__config[featureKey][CONFIG_KEY.SOURCE_FILEPATH] = sourceFilepath;
      }

      if (active === false) {
        this.__config[featureKey][CONFIG_KEY.ACTIVE] = false;
      }

      if (appUrl) {
        this.__config[featureKey][CONFIG_KEY.APP_URL] = appUrl;
        const appUrlRegex = new RegExp(appUrl);
        if (Array.isArray(cfAppUris) && cfAppUris.every((cfAppUri) => !appUrlRegex.test(cfAppUri))) {
          this.__config[featureKey][CONFIG_KEY.APP_URL_ACTIVE] = false;
        }
      }

      if (validations) {
        this.__config[featureKey][CONFIG_KEY.VALIDATIONS] = validations;
      }
    }

    return count;
  }

  /**
   * Populate this.__config.
   */
  _processConfig({ configAuto, configFromFilesEntries, configRuntime } = {}) {
    const configAutoCount = this._processConfigSource(CONFIG_SOURCE.AUTO, CONFIG_MERGE_CONFLICT.OVERRIDE, configAuto);
    const configFromFileCount = configFromFilesEntries.reduce(
      (count, [configFilepath, configFromFile]) =>
        count +
        this._processConfigSource(CONFIG_SOURCE.FILE, CONFIG_MERGE_CONFLICT.OVERRIDE, configFromFile, configFilepath),
      0
    );
    const configRuntimeCount = this._processConfigSource(
      CONFIG_SOURCE.RUNTIME,
      CONFIG_MERGE_CONFLICT.OVERRIDE,
      configRuntime
    );

    // NOTE: this post-processing is easier to do after the configuration is merged
    this.__featureKeys = Object.keys(this.__fallbackValues);
    for (const featureKey of this.__featureKeys) {
      const validations = this.__config[featureKey][CONFIG_KEY.VALIDATIONS];
      if (validations) {
        const sourceFilepath = this.__config[featureKey][CONFIG_KEY.SOURCE_FILEPATH];
        this._processValidations(featureKey, validations, sourceFilepath);
      }
    }

    this.__isConfigProcessed = true;
    return {
      [CONFIG_SOURCE.AUTO]: configAutoCount,
      [CONFIG_SOURCE.RUNTIME]: configRuntimeCount,
      [CONFIG_SOURCE.FILE]: configFromFileCount,
    };
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
   * Implementation for {@link constructor}.
   *
   * @param {ConstructorOptions} [options]
   */
  _reset({
    uniqueName = FeatureToggles._getDefaultUniqueName(),
    redisChannel = DEFAULT_REDIS_CHANNEL,
    redisKey = DEFAULT_REDIS_KEY,
  } = {}) {
    this.__uniqueName = uniqueName;
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
    this.__initializePromise = undefined;
    this.__isInitialized = false;
    this.__isConfigProcessed = false;
  }

  /**
   * @typedef ConstructorOptions
   * @type object
   * @property {string}  [uniqueName]     unique name to prefix both Redis channel and key
   * @property {string}  [redisChannel]   channel for Redis pub/sub to propagate changes across servers
   * @property {string}  [redisKey]       key in Redis to save non-fallback values
   */
  /**
   * NOTE: constructors cannot be async, so we need to split this state preparation part from the initialize part
   * @param {ConstructorOptions}  [options]
   */
  constructor(options) {
    this._reset(options);
  }

  // ========================================
  // END OF CONSTRUCTOR SECTION
  // ========================================
  // ========================================
  // START OF SINGLETON SECTION
  // ========================================

  /**
   * Get singleton instance
   *
   * @returns {FeatureToggles}
   */
  static getInstance() {
    if (!FeatureToggles.__instance) {
      FeatureToggles.__instance = new FeatureToggles();
    }
    return FeatureToggles.__instance;
  }

  // ========================================
  // END OF SINGLETON SECTION
  // ========================================
  // ========================================
  // START OF VALIDATION SECTION
  // ========================================

  static _isValidFeatureKey(config, featureKey) {
    return typeof featureKey === "string" && Object.prototype.hasOwnProperty.call(config, featureKey);
  }

  static _isValidFeatureValueType(value) {
    return value === null || FEATURE_VALID_TYPES.includes(typeof value);
  }

  static _isValidScopeKey(scopeKey) {
    return scopeKey === undefined || typeof scopeKey === "string";
  }

  static _isValidScopeMapValue(value) {
    return typeof value === "string";
  }

  // NOTE: this function is used during initialization, so we cannot check this.__isInitialized
  async _validateFeatureValue(featureKey, value, { scopeMap, scopeKey, isChange = false, remoteOnly = false } = {}) {
    if (!this.__isConfigProcessed) {
      return [{ errorMessage: "not initialized" }];
    }

    // NOTE: for remoteOnly we only allow values that are not configured
    if (remoteOnly) {
      if (this.__config[featureKey]) {
        return [{ featureKey, errorMessage: "remoteOnly is not allowed for configured toggles" }];
      }
      return [];
    }

    if (!FeatureToggles._isValidFeatureKey(this.__config, featureKey)) {
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

    // NOTE: value === null is our way of encoding featureKey resetting changes, so it is allowed for changes but not
    //   for actual values
    if (value === null) {
      if (isChange) {
        return [];
      } else {
        return [{ featureKey, ...(scopeKey && { scopeKey }), errorMessage: "value null is not allowed" }];
      }
    }

    // NOTE: skip validating active properties during initialization
    if (this.__isInitialized) {
      if (this.__config[featureKey][CONFIG_KEY.ACTIVE] === false) {
        return [{ featureKey, errorMessage: "feature key is not active" }];
      }

      if (this.__config[featureKey][CONFIG_KEY.APP_URL_ACTIVE] === false) {
        return [
          {
            featureKey,
            errorMessage: "feature key is not active because app url does not match regular expression {0}",
            errorMessageValues: [this.__config[featureKey][CONFIG_KEY.APP_URL]],
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
   * ValidationError must have a user-readable errorMessage. The message can use errorMessageValues, i.e., parameters
   * which are ignored for localization, but mixed in when the errorMessage is presented to the user.
   *
   * @example
   * const validationErrors = [
   *   { errorMessage: "got bad value" },
   *   { errorMessage: 'got bad value with parameter "{0}"', errorMessageValues: [paramFromValue(value)] }
   * ];
   *
   * @typedef ValidationError
   * @type object
   * @property {string}         featureKey            feature toggle
   * @property {string}         errorMessage          user-readable error message
   * @property {Array<string>}  [errorMessageValues]  optional parameters for error message, which are ignored for
   *                                                    localization
   */
  /**
   * Validate the value of a given featureKey, value pair. Allows passing an optional scopeMap that is added to
   * validationErrors for reference.
   *
   * @param {string}                      featureKey  feature key
   * @param {string|number|boolean|null}  value       intended value
   * @param {Object}                      [scopeMap]  optional scope restrictions
   * @returns {Promise<Array<ValidationError>>}       validation errors if any are found or an empty array otherwise
   */
  async validateFeatureValue(featureKey, value, scopeMap = undefined) {
    return scopeMap === undefined
      ? await this._validateFeatureValue(featureKey, value)
      : await this._validateFeatureValue(featureKey, value, {
          scopeMap,
          scopeKey: FeatureToggles.getScopeKey(scopeMap),
        });
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
      const entryValidationErrors = await this._validateFeatureValue(featureKey, value, {
        scopeMap: FeatureToggles.getScopeMap(scopeKey),
        scopeKey,
      });
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
        !FeatureToggles._isValidFeatureKey(this.__config, featureKey) ||
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

  static async readConfigFromFile(configFilepath = DEFAULT_CONFIG_FILEPATH) {
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
      "config filepath with unsupported extension, allowed extensions are .yaml and .json"
    );
  }

  static async _consolidatedConfigFilepaths(configFilepath, configFilepaths) {
    let result = [];
    if (configFilepath) {
      result.push(configFilepath);
    }
    if (configFilepaths) {
      result = result.concat(Object.values(configFilepaths));
    }
    if (result.length === 0 && (await tryPathReadable(DEFAULT_CONFIG_FILEPATH))) {
      result.push(DEFAULT_CONFIG_FILEPATH);
    }
    return result;
  }

  /**
   * Implementation for {@link initializeFeatures}.
   *
   * @param {InitializeOptions}  [options]
   */
  async _initializeFeatures({
    configAuto,
    configFile: configFilepath,
    configFiles: configFilepaths,
    config: configRuntime,
    customRedisCredentials,
    customRedisClientOptions,
  } = {}) {
    if (this.__isInitialized) {
      return;
    }

    const consolidatedConfigFilepaths = await FeatureToggles._consolidatedConfigFilepaths(
      configFilepath,
      configFilepaths
    );
    const configFromFilesEntries = await Promise.all(
      consolidatedConfigFilepaths.map(async (configFilepath) => {
        try {
          return [configFilepath, await FeatureToggles.readConfigFromFile(configFilepath)];
        } catch (err) {
          throw new VError(
            {
              name: VERROR_CLUSTER_NAME,
              cause: err,
              info: {
                configFilepath,
              },
            },
            "initialization aborted, could not read config file"
          );
        }
      })
    );

    let toggleCounts;
    try {
      toggleCounts = this._processConfig({
        configAuto,
        configFromFilesEntries,
        configRuntime,
      });
    } catch (err) {
      throw new VError(
        {
          name: VERROR_CLUSTER_NAME,
          cause: err,
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

    redis.setCustomOptions(customRedisCredentials, customRedisClientOptions);
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
          cfEnv.isOnCf
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

    const totalCount =
      toggleCounts[CONFIG_SOURCE.AUTO] + toggleCounts[CONFIG_SOURCE.FILE] + toggleCounts[CONFIG_SOURCE.RUNTIME];
    logger.info(
      [
        "finished initialization",
        ...(this.__uniqueName ? [`of "${this.__uniqueName}"`] : []),
        util.format(
          "with %i feature toggles (%i auto, %i file, %i runtime)",
          totalCount,
          toggleCounts[CONFIG_SOURCE.AUTO],
          toggleCounts[CONFIG_SOURCE.FILE],
          toggleCounts[CONFIG_SOURCE.RUNTIME]
        ),
        `using ${redisIntegrationMode}`,
      ].join(" ")
    );
    this.__isInitialized = true;
    return this;
  }

  /**
   * TODO
   * @typedef Config
   * @type object
   */
  /**
   * @typedef InitializeOptions
   * @type object
   * @property {Config}  [config]
   * @property {string}  [configFile]
   * @property {string}  [configFiles]
   * @property {Config}  [configAuto]
   * @property {object}  [customRedisCredentials]
   * @property {object}  [customRedisClientOptions]
   */
  /**
   * Initialize needs to run and finish before other APIs are called. It processes the configuration, sets up
   * related internal state, and starts communication with redis.
   *
   * @param {InitializeOptions}  [options]
   */
  async initializeFeatures(options) {
    if (this.__initializePromise) {
      throw new VError({ name: VERROR_CLUSTER_NAME }, "already initialized");
    }
    this.__initializePromise = this._initializeFeatures(options);
    return await this.__initializePromise;
  }

  get canInitialize() {
    return !this.__initializePromise;
  }

  // ========================================
  // END OF INITIALIZE SECTION
  // ========================================
  // ========================================
  // START OF GET_FEATURES_INFOS SECTION
  // ========================================

  _getFeatureInfo(featureKey, { stateScopedValues = this.__stateScopedValues } = {}) {
    let rootValue;
    let foundScopedValues = false;
    let scopedValuesInfo;
    if (stateScopedValues[featureKey]) {
      scopedValuesInfo = Object.entries(stateScopedValues[featureKey]).reduce((acc, [scopeKey, value]) => {
        if (scopeKey === SCOPE_ROOT_KEY) {
          rootValue = value;
        } else {
          foundScopedValues = true;
          acc[scopeKey] = value;
        }
        return acc;
      }, {});
    }

    const isConfigured = this.__config[featureKey];
    const configInfo = isConfigured
      ? Object.entries(this.__config[featureKey]).reduce((acc, [configKey, value]) => {
          if (CONFIG_INFO_KEY[configKey]) {
            acc[configKey] = value;
          }
          return acc;
        }, {})
      : { [CONFIG_KEY.SOURCE]: CONFIG_SOURCE.NONE };

    return {
      ...(isConfigured && { fallbackValue: this.__fallbackValues[featureKey] }),
      ...(rootValue !== undefined && { rootValue }),
      ...(foundScopedValues && { scopedValues: scopedValuesInfo }),
      config: configInfo,
    };
  }

  /**
   * Get feature info for specific featureKey.
   */
  getFeatureInfo(featureKey) {
    this._ensureInitialized();
    if (!FeatureToggles._isValidFeatureKey(this.__config, featureKey)) {
      return null;
    }
    return this._getFeatureInfo(featureKey);
  }

  /**
   * Get server-local feature infos for all configured keys.
   */
  getFeaturesInfos() {
    this._ensureInitialized();
    return this.__featureKeys.reduce((acc, featureKey) => {
      acc[featureKey] = this._getFeatureInfo(featureKey);
      return acc;
    }, {});
  }

  /**
   * Get remote feature infos for all keys that exist in the redis hash entry, including keys that are not configured.
   */
  async getRemoteFeaturesInfos() {
    this._ensureInitialized();

    let remoteStateScopedValues;
    // NOTE: for NO_REDIS mode, we show local updates
    if ((await redis.getIntegrationMode()) === REDIS_INTEGRATION_MODE.NO_REDIS) {
      remoteStateScopedValues = this.__stateScopedValues;
    } else {
      remoteStateScopedValues = await redis.hashGetAllObjects(this.__redisKey);
    }

    if (!remoteStateScopedValues) {
      return null;
    }

    return Object.keys(remoteStateScopedValues).reduce((acc, key) => {
      acc[key] = this._getFeatureInfo(key, { stateScopedValues: remoteStateScopedValues });
      return acc;
    }, {});
  }

  // ========================================
  // END OF GET_FEATURES_INFOS SECTION
  // ========================================
  // ========================================
  // START OF GET_FEATURES_KEYS SECTION
  // ========================================

  /**
   * Get the names of all configured feature keys.
   *
   * @returns {Array<string>}
   */
  getFeaturesKeys() {
    this._ensureInitialized();
    return this.__featureKeys.slice();
  }

  // ========================================
  // END OF GET_FEATURES_KEYS SECTION
  // ========================================
  // ========================================
  // START OF GET_FEATURE_VALUE SECTION
  // ========================================

  /**
   * This is used to make sure scopeMap is either undefined or a shallow map with string entries. This happens for all
   * public interfaces with a scopeMap parameter, except {@link validateFeatureValue} and {@link changeFeatureValue}.
   * For these two interfaces, we want the "bad" scopeMaps to cause validation errors.
   * Also, not for {@link getScopeKey}, where the sanitization must not happen in place.
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
   * @param {Object}               [scopeMap]  optional scope restrictions
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
    // NOTE: if there are no existing scoped values, or we want to delete everything but the root key, than the
    //   response is trivial.
    if (!scopedValues || (clearSubScopes && scopeKey === SCOPE_ROOT_KEY)) {
      if (newValue !== null) {
        return { [scopeKey]: newValue };
      } else {
        return null;
      }
    }

    if (clearSubScopes) {
      // NOTE: we use here, that the scopeKey !== SCOPE_ROOT_KEY
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
      Reflect.deleteProperty(scopedValues, scopeKey);
      if (Object.keys(scopedValues).length === 0) {
        return null;
      }
    }
    return scopedValues;
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
   * ChangeOptions are extra options for the change of a feature toggle.
   *
   * Example:
   *   { clearSubScopes: true }
   *
   * @typedef ChangeOptions
   * @type object
   * @property {boolean}  [clearSubScopes]  switch to clear all sub scopes, defaults to false
   * @property {boolean}  [remoteOnly]      switch to skip all server-local processing to change toggles that are not
   *                                          configured, defaults to false
   */
  /**
   * ChangeEntry represents a single value change related to a feature key and an optional scopeMap. Setting newValue
   * to null means delete the value. Omitting the scopeMap changes the root scope.
   *
   * @example
   * const FEATURE_VALUE_KEY = "/server/part_x/feature_y";
   * const entries = [
   *   { featureKey: FEATURE_VALUE_KEY, newValue: true },
   *   { featureKey: FEATURE_VALUE_KEY, newValue: true, scopeMap: { tenant: "t1" } },
   *   { featureKey: FEATURE_VALUE_KEY, newValue: null, options: { clearSubScopes: true } }
   * ];
   *
   * @typedef ChangeEntry
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
    return tryJsonParse(message);
  }

  /**
   * Refresh local feature values from redis. This will only refresh the local state and not trigger change handlers.
   */
  // NOTE: refresh used to trigger the change handlers, but with scoping keeping this feature would become really messy.
  // From the state difference, there is no good way to infer the actual scopeMap and options that were used. You would
  // also have to trigger changes for any small scope-level change leading to lots of callbacks.
  async refreshFeatureValues() {
    this._ensureInitialized();
    if ((await redis.getIntegrationMode()) === REDIS_INTEGRATION_MODE.NO_REDIS) {
      return;
    }

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
   * Handler for message with change entries.
   */
  async _messageHandler(message) {
    const changeEntries = FeatureToggles._deserializeChangesFromRefreshMessage(message);
    if (!Array.isArray(changeEntries)) {
      logger.error(
        new VError(
          {
            name: VERROR_CLUSTER_NAME,
            info: {
              channel: this.__redisChannel,
              message,
            },
          },
          "error during message deserialization"
        )
      );
      return;
    }

    await Promise.all(
      changeEntries.map(async (changeEntry) => {
        try {
          if (!isObject(changeEntry) || changeEntry.featureKey === undefined || changeEntry.newValue === undefined) {
            logger.warning(
              new VError(
                {
                  name: VERROR_CLUSTER_NAME,
                  info: {
                    changeEntry: JSON.stringify(changeEntry),
                  },
                },
                "received and ignored change entry"
              )
            );
            return;
          }
          const { featureKey, newValue, scopeMap, options } = changeEntry;

          const scopeKey = FeatureToggles.getScopeKey(scopeMap);
          const oldValue = FeatureToggles._getFeatureValueForScopeAndStateAndFallback(
            this.__superScopeCache,
            this.__stateScopedValues,
            this.__fallbackValues,
            featureKey,
            scopeMap
          );

          const validationErrors = await this._validateFeatureValue(featureKey, newValue, {
            scopeMap,
            scopeKey,
            isChange: true,
          });
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

          FeatureToggles._updateStateScopedValuesOneScopeInPlace(
            this.__stateScopedValues,
            featureKey,
            newValue,
            scopeKey,
            options
          );

          // NOTE: the change handler expects the actual value.
          const newActualValue =
            newValue !== null
              ? newValue
              : FeatureToggles._getFeatureValueForScopeAndStateAndFallback(
                  this.__superScopeCache,
                  this.__stateScopedValues,
                  this.__fallbackValues,
                  featureKey,
                  scopeMap
                );
          await this._triggerChangeHandlers(featureKey, oldValue, newActualValue, scopeMap, options);
        } catch (err) {
          logger.error(
            new VError(
              {
                name: VERROR_CLUSTER_NAME,
                cause: err,
                info: {
                  channel: this.__redisChannel,
                  changeEntry: JSON.stringify(changeEntry),
                },
              },
              "error during message handling"
            )
          );
        }
      })
    );
  }

  async _changeRemoteFeatureValue(featureKey, newValue, scopeMap, options) {
    const { remoteOnly } = options ?? {};
    const scopeKey = FeatureToggles.getScopeKey(scopeMap);
    const validationErrors = await this._validateFeatureValue(featureKey, newValue, {
      scopeMap,
      scopeKey,
      isChange: true,
      remoteOnly,
    });
    if (Array.isArray(validationErrors) && validationErrors.length > 0) {
      return validationErrors;
    }

    const integrationMode = await redis.getIntegrationMode();
    // NOTE: for NO_REDIS mode, we just do a local update without further validation
    if (integrationMode === REDIS_INTEGRATION_MODE.NO_REDIS) {
      if (!remoteOnly) {
        const oldValue = FeatureToggles._getFeatureValueForScopeAndStateAndFallback(
          this.__superScopeCache,
          this.__stateScopedValues,
          this.__fallbackValues,
          featureKey,
          scopeMap
        );
        FeatureToggles._updateStateScopedValuesOneScopeInPlace(
          this.__stateScopedValues,
          featureKey,
          newValue,
          scopeKey,
          options
        );
        const newActualValue =
          newValue !== null
            ? newValue
            : FeatureToggles._getFeatureValueForScopeAndStateAndFallback(
                this.__superScopeCache,
                this.__stateScopedValues,
                this.__fallbackValues,
                featureKey,
                scopeMap
              );
        await this._triggerChangeHandlers(featureKey, oldValue, newActualValue, scopeMap, options);
      }
      return;
    }

    const newRedisStateCallback = (scopedValues) =>
      FeatureToggles._updateScopedValuesInPlace(scopedValues, newValue, scopeKey, options);
    try {
      await redis.watchedHashGetSetObject(this.__redisKey, featureKey, newRedisStateCallback);
      if (!remoteOnly) {
        // NOTE: it would be possible to pass along the scopeKey here as well, but really it can be efficiently computed
        // from the scopeMap by the receiver, so we leave it out here.
        const changeEntry = { featureKey, newValue, ...(scopeMap && { scopeMap }), ...(options && { options }) };
        await redis.publishMessage(
          this.__redisChannel,
          FeatureToggles._serializeChangesToRefreshMessage([changeEntry])
        );
      }
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
   * @param {Object}                      [scopeMap]  optional scope restrictions
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
   * @param {boolean | number | string}  newValue
   * @param {boolean | number | string}  oldValue
   * @param {Object}                     [scopeMap]  optional scope restrictions
   * @param {ChangeOptions}              [options]   optional switch to clear all sub scopes
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
   * @param {Object}                     [scopeMap]  optional scopeMap for reference
   * @param {string}                     [scopeKey]  optional scopeKey for reference
   * @returns {undefined | ValidationError | Array<ValidationError>} in case of failure a ValidationError, or an array
   *   of ValidationErrors, otherwise undefined
   */
  /**
   * Register a validator for given feature value key. If you register a validator _before_ initialization, it will
   * be executed during initialization, otherwise it will only run for new values coming in after initialization.
   * Errors happening during validation execution will be logged and communicated to user as generic problem.
   *
   * @example
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
  ENV,
  DEFAULT_REDIS_CHANNEL,
  DEFAULT_REDIS_KEY,
  DEFAULT_CONFIG_FILEPATH,
  SCOPE_ROOT_KEY,
  FeatureToggles,

  _: {
    CONFIG_KEY,
    CONFIG_INFO_KEY,
    _getLogger: () => logger,
    _setLogger: (value) => (logger = value),
  },
};
