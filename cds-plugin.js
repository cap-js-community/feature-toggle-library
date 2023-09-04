// https://pages.github.tools.sap/cap/docs/node.js/cds-plugins
"use strict";

const cds = require("@sap/cds");
const { initializeFeatures } = require("./src/singleton");

const activate = async () => {
  if (cds.env.featureToggles?.config || cds.env.featureToggles?.configFile) {
    cds.env.requires = Object.assign(cds.env.requires, {
      FeatureService: { model: "@cap-js-community/feature-toggle-library" },
    });

    if (Array.isArray(cds.env.featureToggles.serviceAccessRoles)) {
      cds.on("loaded", (csn) => {
        if (csn.definitions.FeatureService) {
          csn.definitions.FeatureService["@requires"] = cds.env.featureToggles.serviceAccessRoles;
        }
      });
    }

    await initializeFeatures({
      config: cds.env.featureToggles.config,
      configFile: cds.env.featureToggles.configFile,
    });
  }
};

module.exports = {
  activate,
};
