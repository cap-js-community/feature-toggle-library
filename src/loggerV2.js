"use strict";
const util = require("util");
const VError = require("verror");

const { cfEnv } = require("./env");

// NOTE: missing fields
// "source_instance": 1, SAME AS component_instance
// "response_time_ms": 100.33176499999999
// "container_id": "10.36.133.5",
const FIELD = Object.freeze({
  TYPE: "type",
  LEVEL: "level",
  LAYER: "layer", // AFC custom

  COMPONENT_NAME: "component_name",
  COMPONENT_ID: "component_id",
  COMPONENT_INSTANCE: "component_instance",
  COMPONENT_TYPE: "component_type",
  SPACE_NAME: "space_name",
  SPACE_ID: "space_id",
  ORGANIZATION_NAME: "organization_name",
  ORGANIZATION_ID: "organization_id",

  STACKTRACE: "stacktrace",
  ERROR_INFO: "error_info", // AFC custom

  WRITTEN_AT: "written_at",
  WRITTEN_TIME: "written_ts",
  MESSAGE: "msg",

  TENANT_ID: "tenant_id",
  TENANT_SUBDOMAIN: "tenant_subdomain",
  CORRELATION_ID: "correlation_id",
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

// this is for module server code without any request context
class ServerLogger {
  constructor({ type = "log", level = LEVEL.INFO, layer, inspectOptions = { colors: false } } = {}) {
    this.__inspectOptions = inspectOptions;
    this.__levelNumber = LEVEL_NUMBER[level];
    this.__data = {
      [FIELD.TYPE]: type,
      [FIELD.LEVEL]: level,
      [FIELD.LAYER]: layer,
      ...(cfApp && {
        [FIELD.COMPONENT_TYPE]: "application",
        [FIELD.COMPONENT_NAME]: cfApp.application_name,
        [FIELD.COMPONENT_ID]: cfApp.application_id,
        [FIELD.COMPONENT_INSTANCE]: cfApp.instance_index,
        [FIELD.SPACE_NAME]: cfApp.space_name,
        [FIELD.SPACE_ID]: cfApp.space_id,
        [FIELD.ORGANIZATION_NAME]: cfApp.organization_name,
        [FIELD.ORGANIZATION_ID]: cfApp.organization_id,
      }),
    };
  }

  _log(level, args) {
    // check if level should be logged
    if (LEVEL_NUMBER[level] <= this.__levelNumber) {
      return;
    }
    const now = new Date();
    let message = "";
    if (args.length > 0) {
      const firstArg = args[0];

      // special handling if the only arg is a VError
      if (firstArg instanceof VError) {
        const err = firstArg;
        Object.assign(this.__data, {
          [FIELD.STACKTRACE]: VError.fullStack(err),
          [FIELD.ERROR_INFO]: VError.info(err),
        });
        message = util.formatWithOptions(this.__inspectOptions, "%s", VError.fullStack(err));
      }
      // special handling if the only arg is an Error
      else if (firstArg instanceof Error) {
        const err = firstArg;
        Object.assign(this.__data, {
          [FIELD.STACKTRACE]: err.stack,
        });
        message = util.formatWithOptions(this.__inspectOptions, "%s", err.stack);
      }
      // normal handling
      else {
        message = util.formatWithOptions(this.__inspectOptions, ...args);
      }
    }

    Object.assign(this.__data, {
      [FIELD.WRITTEN_AT]: now.toISOString(),
      [FIELD.WRITTEN_TIME]: now.getTime(),
      [FIELD.MESSAGE]: message,
    });
    process.stdout.write(JSON.stringify(this.__data) + "\n");
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

// Readable logger for running locally
class ReadableLogger {
  constructor() {
    this.__fields = {};
  }

  setCustomFields(fields) {
    this.__fields = fields;
  }

  logMessage(level, ...args) {
    const logger =
      level === LEVEL.OFF
        ? noopLogger
        : level === LEVEL.ERROR
        ? // eslint-disable-next-line no-console
          console.error
        : level === LEVEL.WARNING
        ? // eslint-disable-next-line no-console
          console.warn
        : // eslint-disable-next-line no-console
          console.info;
    const { [CUSTOM_FIELD_LAYER]: layer, [CUSTOM_FIELD_ERROR_INFO]: errInfo } = this.__fields;

    const lastArg = args.length > 0 ? args[args.length - 1] : null;
    // NOTE: cf-nodejs-logging-support removes lastArg errors with .stack fields from the msg field output, so we
    //   emulate this behavior here
    const formatArgs = lastArg instanceof VError ? args.slice(0, -1) : args;
    const formattedMessage = util.format(...formatArgs);
    const now = new Date();
    const timestamp = util.format(
      "%s:%s:%s.%s",
      ("0" + now.getHours()).slice(-2),
      ("0" + now.getMinutes()).slice(-2),
      ("0" + now.getSeconds()).slice(-2),
      ("00" + now.getMilliseconds()).slice(-3)
    );
    const logLineParts = Object.values({
      timestamp,
      level,
      ...(layer && { layer }),
      formattedMessage,
    });
    const logParts = Object.values({
      logLineParts: logLineParts.join(" | "),
      ...(errInfo && { errInfo: util.format("error info: %O", errInfo) }),
    });
    logger(logParts.join("\n"));
  }
}

// General logger wrapper
class Logger {
  constructor(layer, doJSONOutput = true) {
    this.__layer = layer;
    this.__doJSONOutput = doJSONOutput;
    if (this.__doJSONOutput) {
      this.__logger = globalLogger.createLogger();
    } else {
      this.__logger = new ReadableLogger();
    }
    this._resetCustomFields();
  }

  _resetCustomFields() {
    this.__logger.setCustomFields({ [CUSTOM_FIELD_LAYER]: this.__layer });
  }

  // NOTE: cf-nodejs-logging-support does not handle VErrors properly. We fill the layer and errorInfo custom fields
  // with the related information and then pass the error twice to logMessage, first as VError.fullStack(err), which
  // ends up in the msg field and second as err itself, which ends up in the stacktrace field. See "check json logging"
  // test.
  _log(level, ...args) {
    if (args.length === 1 && args[0] instanceof VError) {
      const err = args[0];
      const errInfo = VError.info(err);
      this.__logger.setCustomFields({
        [CUSTOM_FIELD_LAYER]: this.__layer,
        [CUSTOM_FIELD_ERROR_INFO]: errInfo,
      });
      this.__logger.logMessage(level, VError.fullStack(err), err);
      this._resetCustomFields();
    } else {
      this.__logger.logMessage(level, ...args);
    }
  }

  error(...args) {
    return this._log(LEVEL.ERROR, ...args);
  }
  warning(...args) {
    return this._log(LEVEL.WARNING, ...args);
  }
  info(...args) {
    return this._log(LEVEL.INFO, ...args);
  }
  verbose(...args) {
    return this._log(LEVEL.VERBOSE, ...args);
  }
  debug(...args) {
    return this._log(LEVEL.DEBUG, ...args);
  }
  silly(...args) {
    return this._log(LEVEL.SILLY, ...args);
  }
}

module.exports = { Logger, ReadableLogger };
