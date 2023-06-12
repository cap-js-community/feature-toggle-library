"use strict";

const { FeatureToggles, readConfigFromFile, SCOPE_ROOT_KEY } = require("./featureToggles");
const singleton = require("./singleton");
const redisWrapper = require("./redisWrapper");
const { LazyCache, ExpiringLazyCache } = require("./shared/cache");
const { HandlerCollection } = require("./shared/handlerCollection");
const { promiseAllDone } = require("./shared/promiseAllDone");
const { Semaphore } = require("./shared/semaphore");

module.exports = {
  FeatureToggles,
  readConfigFromFile,
  SCOPE_ROOT_KEY,
  singleton,
  redisWrapper,
  LazyCache,
  ExpiringLazyCache,
  HandlerCollection,
  promiseAllDone,
  Semaphore,
};
