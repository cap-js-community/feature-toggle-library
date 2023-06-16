"use strict";

const cds = require("@sap/cds");
const {
  singleton: { initializeFeatures },
} = require("@cap-js-community/feature-toggle-library");

const { FEATURES_FILEPATH } = require("./feature");
const { initializeMemoryStatistics } = require("./memoryStatistics");

cds.on("bootstrap", async () => {
  await initializeFeatures({ configFile: FEATURES_FILEPATH });
  await initializeMemoryStatistics();
});
