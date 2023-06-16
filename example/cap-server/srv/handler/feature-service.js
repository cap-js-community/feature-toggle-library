"use strict";

const {
  singleton: { getFeaturesInfos, refreshFeatureValues, changeFeatureValue },
} = require("@cap-js-community/feature-toggle-library");
const cds = require("@sap/cds");

const VALIDATION_ERROR_HTTP_CODE = 422;

/**
 * Read all feature values.
 */
const stateHandler = async (context) => {
  const result = getFeaturesInfos();
  return context.reply(result);
};

/**
 * Refresh feature values from redis and then read all.
 */
const redisReadHandler = async (context) => {
  try {
    await refreshFeatureValues();
    const result = getFeaturesInfos();
    context.reply(result);
  } catch (err) {
    cds.log().error(err);
    context.reject(500, { message: "caught unexpected error during redis read, check server logs" });
  }
};

// TODO this is straight up wrong
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
  try {
    const processEntry = async (entry) => {
      const { key, value, scope: scopeMap, options } = entry ?? {};
      const validationErrors = await changeFeatureValue(key, value, scopeMap, options);
      if (Array.isArray(validationErrors) && validationErrors.length > 0) {
        for (const { featureKey: target, errorMessage, errorMessageValues } of validationErrors) {
          // TODO this could be better
          const errorMessageWithValues = JSON.stringify([errorMessage, errorMessageValues]);
          context.error(VALIDATION_ERROR_HTTP_CODE, { message: errorMessageWithValues }, [], target);
        }
      }
    };
    if (Array.isArray(context.data)) {
      for (const entry of context.data) {
        await processEntry(entry);
      }
    } else {
      await processEntry(context.data);
    }
    context.reply();
  } catch (err) {
    cds.log().error(err);
    context.reject(500, { message: "caught unexpected error during redis update, check server logs" });
  }
};

// TODO ideally we would want redis sendCommand here as well

module.exports = async (srv) => {
  const { state, redisRead, redisUpdate } = srv.operations("FeatureService");
  srv.on(state, stateHandler);
  srv.on(redisRead, redisReadHandler);
  srv.on(redisUpdate, redisUpdateHandler);
};
