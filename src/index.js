"use strict";

const featureToggles = require("./featureToggles");
const redisWrapper = require("./redisWrapper");
const lazyCache = require("./lazyCache");

module.exports = {
  ...featureToggles,
  redisWrapper,
  lazyCache,
};
