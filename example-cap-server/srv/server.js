"use strict";

const cds = require("@sap/cds");
const { initializeMemoryStatistics } = require("./memoryStatistics");

cds.on("bootstrap", async () => {
  await initializeMemoryStatistics();
});
