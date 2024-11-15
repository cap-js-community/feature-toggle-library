"use strict";

const cds = require("@sap/cds");
const { initializeMemoryStatistics } = require("./memory-statistics");

cds.on("bootstrap", async () => {
  await initializeMemoryStatistics();
});
