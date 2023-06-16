"use strict";

const { format } = require("util");

const cds = require("@sap/cds");
const {
  singleton: { registerFeatureValueChangeHandler, getFeatureValue },
  DynamicIntervalController,
} = require("@cap-js-community/feature-toggle-library");
const {
  FEATURE: { MEM_STAT_ACTIVE, MEM_STAT_LOG_INTERVAL },
} = require("./feature");

const logger = cds.log("memoryStatistics");

const _logStatistics = () => {
  const memoryUsage = process.memoryUsage?.();
  if (memoryUsage) {
    logger.info(format("%O", memoryUsage));
  }
};

const initializeMemoryStatistics = () => {
  const logIntervalController = new DynamicIntervalController(
    _logStatistics,
    getFeatureValue(MEM_STAT_ACTIVE),
    getFeatureValue(MEM_STAT_LOG_INTERVAL)
  );

  registerFeatureValueChangeHandler(MEM_STAT_ACTIVE, (newValue) => logIntervalController.setActive(newValue));
  registerFeatureValueChangeHandler(MEM_STAT_LOG_INTERVAL, (newValue) =>
    logIntervalController.setWaitInterval(newValue)
  );

  return logIntervalController;
};

module.exports = {
  initializeMemoryStatistics,
};
