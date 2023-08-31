// https://cap.cloud.sap/docs/releases/march23#new-cds-plugin-technique
"use strict";

const cds = require("@sap/cds");
const { initializeFeatures } = require("./src/singleton");

module.exports = {
  activate: async () => {
    if (cds.env.featureToggles && cds.env.featureToggles.plugin) {
      await initializeFeatures({
        config: cds.env.featureToggles.config,
        configFile: cds.env.featureToggles.configFile,
      });
    }
  },
};
