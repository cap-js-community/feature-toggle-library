"use strict";

const featureToggles = require("./featureToggles");
const redisWrapper = require("./redisWrapper");
const lazyCaches = require("./lazyCaches");

module.exports = {
  ...featureToggles,
  redisWrapper,
  lazyCaches,
};
