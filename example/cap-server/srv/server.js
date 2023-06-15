"use strict";

const pathlib = require("path");

const cds = require("@sap/cds");
const {
  singleton: { initializeFeatures },
} = require("@cap-js-community/feature-toggle-library");

const FEATURES_FILEPATH = pathlib.join(__dirname, "..", "featureTogglesConfig.yaml");

module.exports = async (options) => {
  await initializeFeatures({
    configFile: FEATURES_FILEPATH,
  });
  return cds.server(options);
};
