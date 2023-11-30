"use strict";

const { FeatureToggles } = require("./featureToggles");

const toggles = FeatureToggles.getInstance();

// NOTE: we want to export the FeatureToggles class along with the singleton instance. You would need ESM to do
//   this properly.
toggles.FeatureToggles = FeatureToggles;

module.exports = toggles;
