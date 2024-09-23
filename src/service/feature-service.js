"use strict";

const VError = require("verror");
const toggles = require("../");
const redis = require("../redisWrapper");
const { Logger } = require("../shared/logger");

const COMPONENT_NAME = "/FeatureService";
const VERROR_CLUSTER_NAME = "FeatureServiceError";
const VALIDATION_ERROR_HTTP_CODE = 422;

const logger = new Logger(COMPONENT_NAME);

const textFormat = (pattern, values) =>
  pattern.replace(/\{(\d+)}/g, (match, group) => {
    const index = parseInt(group);
    if (!Number.isNaN(index) && index < values.length) {
      return values[index];
    }
  });

/**
 * Read all configured features and their values.
 */
const stateHandler = async (context) => {
  const result = toggles.getFeaturesInfos();
  return context.reply(result);
};

/**
 * Read all redis features and their values.
 */
const redisReadHandler = async (context) => {
  try {
    const result = await toggles.getRemoteFeaturesInfos();
    if (result === null) {
      context.error({ code: 503, message: "cloud not reach redis during redis read" });
      return;
    }
    context.reply(result);
  } catch (err) {
    logger.error(
      new VError(
        {
          name: VERROR_CLUSTER_NAME,
          cause: err,
        },
        "error during redis read"
      )
    );
    context.error({ code: 500, message: "caught unexpected error during redis read, check server logs" });
  }
};

/**
 * Add, remove, or change one or many feature values. The value = null means resetting the respective key to its
 * fallback value. Validation ensures that only values of type string, number, and boolean are allowed. You can also
 * scope changes to only take effect in specific contexts.
 *
 * Examples:
 *   single-feature input = { "key": "a", "value": true }
 *   multi-feature input  = [
 *     { "key": "a", "value": true },
 *     { "key": "b", "value": 10 }
 *   ]
 *   scoped change input  = { "key": "a", "value": true, "scope": { "tenant": "t1" }}
 *
 * NOTE this will answer 204 if the input was accepted and sent to redis, otherwise 422 with a list of validation
 * errors.
 * @private
 */
const redisUpdateHandler = async (context) => {
  try {
    logger.info("redis update triggered with %O", context.data);
    const processEntry = async (entry) => {
      const { key, value, scope: scopeMap, options } = entry ?? {};
      const validationErrors = await toggles.changeFeatureValue(key, value, scopeMap, options);
      if (Array.isArray(validationErrors) && validationErrors.length > 0) {
        for (const { featureKey: target, errorMessage, errorMessageValues } of validationErrors) {
          const errorMessageWithValues = textFormat(errorMessage, errorMessageValues);
          context.error({ code: VALIDATION_ERROR_HTTP_CODE, message: errorMessageWithValues, target });
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
    logger.error(
      new VError(
        {
          name: VERROR_CLUSTER_NAME,
          cause: err,
        },
        "error during redis update"
      )
    );
    context.error({ code: 500, message: "caught unexpected error during redis update, check server logs" });
  }
};

const redisSendCommandHandler = async (context) => {
  const { command } = context.data;
  if (!Array.isArray(command)) {
    context.error({ code: 400, message: "request body needs to contain a 'command' field of type array" });
    return;
  }
  const redisResponse = await redis.sendCommand(command);
  const result = typeof redisResponse === "string" ? redisResponse : JSON.stringify(redisResponse);
  context.reply(result);
};

module.exports = async (srv) => {
  const { state, redisRead, redisUpdate, redisSendCommand } = srv.operations("FeatureService");
  srv.on(state, stateHandler);
  srv.on(redisRead, redisReadHandler);
  srv.on(redisUpdate, redisUpdateHandler);
  srv.on(redisSendCommand, redisSendCommandHandler);
};
