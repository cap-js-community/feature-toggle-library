"use strict";

const { FeatureToggles } = require("./feature-toggles");

const toggles = FeatureToggles.getInstance();
module.exports = toggles;
