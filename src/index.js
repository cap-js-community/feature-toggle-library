"use strict";

const { SCOPE_ROOT_KEY, FeatureToggles, readConfigFromFile } = require("./featureToggles");
const singleton = require("./singleton");
const redisWrapper = require("./redisWrapper");
const {
  DEFAULT_SEPARATOR,
  DEFAULT_EXPIRATION_GAP,
  DEFAULT_SIZE_LIMIT,
  LazyCache,
  ExpiringLazyCache,
  LimitedLazyCache,
} = require("./shared/cache");
const { DynamicIntervalController } = require("./shared/dynamicIntervalController");
const { HandlerCollection } = require("./shared/handlerCollection");
const { promiseAllDone } = require("./shared/promiseAllDone");
const { Semaphore } = require("./shared/semaphore");

module.exports = {
  SCOPE_ROOT_KEY,
  FeatureToggles,
  readConfigFromFile,

  singleton,

  redisWrapper,

  DEFAULT_SEPARATOR,
  DEFAULT_EXPIRATION_GAP,
  DEFAULT_SIZE_LIMIT,
  LazyCache,
  ExpiringLazyCache,
  LimitedLazyCache,

  DynamicIntervalController,
  HandlerCollection,
  promiseAllDone,
  Semaphore,
};
