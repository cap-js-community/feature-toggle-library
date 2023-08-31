// https://cap.cloud.sap/docs/releases/march23#new-cds-plugin-technique
"use strict";

const cds = require("@sap/cds");

const { initializeFeatures } = require("./src/singleton");

if (cds.env.featureToggles && cds.env.featureToggles.plugin) {
  cds.on("bootstrap", async () => {
    await initializeFeatures({ configFile: cds.env.featureToggles.configFile });
  });
}
