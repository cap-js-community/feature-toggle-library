// https://cap.cloud.sap/docs/node.js/cds-plugins
"use strict";

const cds = require("@sap/cds");
const { initializeFeatures } = require("./src/singleton");

const activate = async () => {
  const envFeatureToggles = cds.env.featureToggles;
  if (envFeatureToggles?.config || envFeatureToggles?.configFile) {
    // TODO this is currently done in package.json, because "cds build" ignores it otherwise. However, it should happen
    //  dynamically.
    // cds.env.requires["FeatureService"] = { model: "@cap-js-community/feature-toggle-library" };

    if (Array.isArray(envFeatureToggles.serviceAccessRoles)) {
      cds.on("loaded", (csn) => {
        if (csn.definitions.FeatureService) {
          csn.definitions.FeatureService["@requires"] = envFeatureToggles.serviceAccessRoles;
        }
      });
    }

    // TODO for the "cds build" use case, this initialize makes no sense
    await initializeFeatures({
      config: envFeatureToggles.config,
      configFile: envFeatureToggles.configFile,
    });
  }
};

module.exports = {
  activate,
};
