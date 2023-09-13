"use strict";

const { format } = require("util");

const cds = require("@sap/cds");
const {
  singleton: { registerFeatureValueChangeHandler, getFeatureValue },
  DynamicIntervalController,
} = require("@cap-js-community/feature-toggle-library");
const { MEM_STAT_LOG_INTERVAL } = require("./feature");

const logger = cds.log("memoryStatistics");

const _logStatistics = () => {
  const memoryUsage = process.memoryUsage?.();
  if (memoryUsage) {
    logger.info(format("%O", memoryUsage));
  }
};

const initializeMemoryStatistics = () => {
  const value = getFeatureValue(MEM_STAT_LOG_INTERVAL);
  const logIntervalController = new DynamicIntervalController(_logStatistics, value > 0, value);

  registerFeatureValueChangeHandler(MEM_STAT_LOG_INTERVAL, (newValue) => {
    if (newValue <= 0) {
      logIntervalController.setActive(false);
    } else {
      logIntervalController.setWaitInterval(newValue);
      logIntervalController.setActive(true);
    }
  });

  return logIntervalController;
};

module.exports = {
  initializeMemoryStatistics,
};
