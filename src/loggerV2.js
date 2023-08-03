"use strict";
const util = require("util");
const VError = require("verror");

const { cfEnv } = require("./env");

// NOTE: missing fields
// "source_instance": 1, SAME AS component_instance
// "response_time_ms": 100.33176499999999
// "container_id": "10.36.133.5",
const FIELD = Object.freeze({
  // ## CF APP DATA
  COMPONENT_NAME: "component_name",
  COMPONENT_ID: "component_id",
  COMPONENT_INSTANCE: "component_instance",
  COMPONENT_TYPE: "component_type",
  SPACE_NAME: "space_name",
  SPACE_ID: "space_id",
  ORGANIZATION_NAME: "organization_name",
  ORGANIZATION_ID: "organization_id",

  // ## SERVER LOGGER INSTANCE DATA
  TYPE: "type",
  LEVEL: "level",
  LAYER: "layer", // AFC custom

  // ## REQUEST LOGGER INSTANCE DATA
  TENANT_ID: "tenant_id",
  TENANT_SUBDOMAIN: "tenant_subdomain",
  CORRELATION_ID: "correlation_id",

  // ## LOG INVOCATION DATA
  STACKTRACE: "stacktrace",
  ERROR_INFO: "error_info", // AFC custom

  WRITTEN_AT: "written_at",
  WRITTEN_TIME: "written_ts",
  MESSAGE: "msg",
});

// NOTE: logger levels are a complete mess in node. looking at console, npm, winston, and cap there is not unity at all.
//   I will offer the same levels as console and one "off" level.
const LEVEL = Object.freeze({
  OFF: "OFF", // SILENT: "silent"
  ERROR: "ERROR",
  WARNING: "WARNING",
  INFO: "INFO",
  DEBUG: "DEBUG", // VERBOSE: "verbose",
  TRACE: "TRACE", // SILLY: "silly"
});

const LEVEL_NUMBER = Object.freeze({
  [LEVEL.OFF]: 0,
  [LEVEL.ERROR]: 100,
  [LEVEL.WARNING]: 200,
  [LEVEL.INFO]: 300,
  [LEVEL.DEBUG]: 400,
  [LEVEL.TRACE]: 500,
});

const cfApp = cfEnv.cfApp();
const cfAppData = cfApp
  ? {
      [FIELD.COMPONENT_TYPE]: "application",
      [FIELD.COMPONENT_NAME]: cfApp.application_name,
      [FIELD.COMPONENT_ID]: cfApp.application_id,
      [FIELD.COMPONENT_INSTANCE]: cfApp.instance_index,
      [FIELD.SPACE_NAME]: cfApp.space_name,
      [FIELD.SPACE_ID]: cfApp.space_id,
      [FIELD.ORGANIZATION_NAME]: cfApp.organization_name,
      [FIELD.ORGANIZATION_ID]: cfApp.organization_id,
    }
  : undefined;

// this is for module server code without any request context
class ServerLogger {
  constructor({ type = "log", level = LEVEL.INFO, layer, inspectOptions = { colors: false } } = {}) {
    this.__inspectOptions = inspectOptions;
    this.__levelNumber = LEVEL_NUMBER[level];
    this.__serverData = {
      [FIELD.TYPE]: type,
      [FIELD.LEVEL]: level,
      [FIELD.LAYER]: layer,
    };
    this.__requestData = undefined;
  }

  _log(level, args) {
    // check if level should be logged
    if (LEVEL_NUMBER[level] <= this.__levelNumber) {
      return;
    }
    const now = new Date();
    let message = "";
    let invocationErrorData;
    if (args.length > 0) {
      const firstArg = args[0];

      // special handling if the only arg is a VError
      if (firstArg instanceof VError) {
        const err = firstArg;
        invocationErrorData = {
          [FIELD.STACKTRACE]: VError.fullStack(err),
          [FIELD.ERROR_INFO]: VError.info(err),
        };
        message = util.formatWithOptions(this.__inspectOptions, "%s", VError.fullStack(err));
      }
      // special handling if the only arg is an Error
      else if (firstArg instanceof Error) {
        const err = firstArg;
        invocationErrorData = {
          [FIELD.STACKTRACE]: err.stack,
        };
        message = util.formatWithOptions(this.__inspectOptions, "%s", err.stack);
      }
      // normal handling
      else {
        message = util.formatWithOptions(this.__inspectOptions, ...args);
      }
    }

    const invocationData = {
      [FIELD.WRITTEN_AT]: now.toISOString(),
      [FIELD.WRITTEN_TIME]: now.getTime(),
      [FIELD.MESSAGE]: message,
    };
    const data = Object.assign(
      {},
      cfAppData,
      this.__serverData,
      this.__requestData,
      invocationErrorData,
      invocationData
    );
    process.stdout.write(JSON.stringify(data) + "\n");
  }

  error(...args) {
    return this._log(LEVEL.ERROR, args);
  }
  warning(...args) {
    return this._log(LEVEL.WARNING, args);
  }
  info(...args) {
    return this._log(LEVEL.INFO, args);
  }
  debug(...args) {
    return this._log(LEVEL.DEBUG, args);
  }
  trace(...args) {
    return this._log(LEVEL.TRACE, args);
  }
}

// this is for request handler code
class RequestLogger extends ServerLogger {
  constructor({ type = "request" } = {}) {
    super({ type });
  }
}

module.exports = {
  ServerLogger,
  RequestLogger,
};
