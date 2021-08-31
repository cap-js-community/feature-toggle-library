"use strict";

const logging = require("@sap/logging");

const appContext = logging.createAppContext();

const Logger = (category, logContextOptions) => appContext.createLogContext(logContextOptions).getLogger(category);

module.exports = {
  Logger
};
