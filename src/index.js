"use strict";

const { FeatureToggles } = require("./featureToggles");

const toggles = FeatureToggles.getInstance();

module.exports = toggles;
