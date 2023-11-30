"use strict";

const { format } = require("util");

const cds = require("@sap/cds");
const toggles = require("@cap-js-community/feature-toggle-library");
const { MEM_STAT_LOG_INTERVAL } = require("./feature");

const logger = cds.log("memoryStatistics");
let intervalId;

const _logStatistics = () => {
  const memoryUsage = process.memoryUsage?.();
  if (memoryUsage) {
    logger.info(format("%O", memoryUsage));
  }
};

const _updateValue = (newValue) => {
  if (intervalId) {
    clearInterval(intervalId);
  }
  if (newValue > 0) {
    intervalId = setInterval(_logStatistics, newValue);
  }
};

const initializeMemoryStatistics = () => {
  const value = toggles.getFeatureValue(MEM_STAT_LOG_INTERVAL);
  _updateValue(value);

  toggles.registerFeatureValueChangeHandler(MEM_STAT_LOG_INTERVAL, _updateValue);
};

module.exports = {
  initializeMemoryStatistics,
};
