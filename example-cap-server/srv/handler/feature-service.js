"use strict";

const {
  redis,
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

/**
 * Add, remove, or change one or many feature values. The value = null means resetting the respective key to its
 * fallback value. Validation ensures that only values of type string, number, and boolean are allowed. You can also
 * scope changes to only take effect in specific contexts.
 *
 * Examples:
 *   single feature input = { "key": "a", "value": true }
 *   multi feature input = [
 *     { "key": "a", "value": true },
 *     { "key": "b", "value": 10 }
 *   ]
 *   scoped change input = { "key": "a", "value": true, "scope": { "tenant": "t1" }}
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

const redisSendCommandHandler = async (context) => {
  const { command } = context.data;
  if (!Array.isArray(command)) {
    context.reject(400, { message: "request body needs to contain a 'command' field of type array" });
    return;
  }
  const result = await redis.sendCommand(command);
  context.reply(typeof result === "string" ? result : JSON.stringify(result));
};

module.exports = async (srv) => {
  const { state, redisRead, redisUpdate, redisSendCommand } = srv.operations("FeatureService");
  srv.on(state, stateHandler);
  srv.on(redisRead, redisReadHandler);
  srv.on(redisUpdate, redisUpdateHandler);
  srv.on(redisSendCommand, redisSendCommandHandler);
};
