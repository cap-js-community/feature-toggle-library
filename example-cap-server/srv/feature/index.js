"use strict";

const pathlib = require("path");

const FEATURES_FILEPATH = pathlib.join(__dirname, "features.yaml");

const FEATURE = Object.freeze({
  CHECK_API_PRIORITY: "/srv/checkApi/priority",

  MEM_STAT_LOG_INTERVAL: "/srv/memoryStatistics/logInterval",
});

module.exports = {
  FEATURES_FILEPATH,
  FEATURE,
};
