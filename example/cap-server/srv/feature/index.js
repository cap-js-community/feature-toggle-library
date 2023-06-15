"use strict";

const pathlib = require("path");

const FEATURES_FILEPATH = pathlib.join(__dirname, "features.yaml");

const FEATURE = Object.freeze({
  POOL_STAT_ACTIVE: "/srv/util/genericPoolStatistics/active",
  POOL_STAT_LOG_INTERVAL: "/srv/util/genericPoolStatistics/logInterval",

  MEM_STAT_ACTIVE: "/srv/util/memoryStatistics/active",
  MEM_STAT_LOG_INTERVAL: "/srv/util/memoryStatistics/logInterval",
});

module.exports = {
  FEATURES_FILEPATH,
  FEATURE,
};
