"use strict";

const cds = require("@sap/cds");
const {
  singleton: { initializeFeatures },
} = require("@cap-js-community/feature-toggle-library");

const { FEATURES_FILEPATH } = require("./feature");

module.exports = async (options) => {
  await initializeFeatures({
    configFile: FEATURES_FILEPATH,
  });
  return cds.server(options);
};

// TODO start kick-off for memory stuff
