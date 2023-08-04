"use strict";
const util = require("util");
const VError = require("verror");

const { cfEnv, isOnCF } = require("./env");
const { tryRequire } = require("./shared/static");

// TODO: missing fields
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

  // ## BASE DATA
  TYPE: "type",
  LAYER: "layer", // AFC custom

  // ## ASYNC_LOCAL_STORAGE CDS CONTEXT
  CORRELATION_ID: "correlation_id",
  TENANT_ID: "tenant_id",
  TENANT_SUBDOMAIN: "tenant_subdomain", // TODO cannot get this through cds context, so that's nonsense
  // TODO we could add cds context user here, but does that would probably open a data privacy problem

  // ## LOG INVOCATION DATA
  STACKTRACE: "stacktrace", // cf-nodejs-logging-support custom // TODO this has a weird format if we do it like the lib and we don't even use it...
  ERROR_INFO: "error_info", // AFC custom // TODO changed the naming here to be consistent, is that a problem?

  LEVEL: "level",
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

const cds = tryRequire("@sap/cds");
const cfApp = cfEnv.cfApp();
const cfAppData = isOnCF
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

// TODO: readable feels off, but it's tricky. kibana calls it json layout if it's machine readable. and pattern if
//       https://www.elastic.co/guide/en/kibana/8.9/log-settings-examples.html
// this is for module server code without any request context
class Logger {
  constructor({
    layer,
    type = "log",
    level = LEVEL.INFO,
    customData,
    readable = false,
    inspectOptions = { colors: false },
  } = {}) {
    this.__baseData = {
      [FIELD.TYPE]: type,
      [FIELD.LAYER]: layer,
    };
    this.__cdsContext = cds?.context;
    this.__dataList = customData ? [customData] : [];
    this.__readable = readable;
    this.__inspectOptions = inspectOptions;
    this.__levelNumber = LEVEL_NUMBER[level];
  }

  child(data) {
    const child = new Logger();
    Object.assign(child, this);
    // NOTE: Object assign only does a shallow copy, so changes to __dataList would propagate to the children, but
    //   we don't offer an API to change it, so that should be alright.
    child.__dataList = child.__dataList.slice();
    child.__dataList.push(data);
    return child;
  }

  _logData(level, args) {
    let message;
    let invocationErrorData;
    if (args.length > 0) {
      const firstArg = args[0];

      // special handling if the only arg is a VError
      if (firstArg instanceof VError) {
        const err = firstArg;
        invocationErrorData = {
          [FIELD.ERROR_INFO]: JSON.stringify(VError.info(err)),
        };
        message = util.formatWithOptions(this.__inspectOptions, "%s", VError.fullStack(err));
      }
      // special handling if the only arg is an Error
      else if (firstArg instanceof Error) {
        const err = firstArg;
        message = util.formatWithOptions(this.__inspectOptions, "%s", err.stack);
      }
      // normal handling
      else {
        message = util.formatWithOptions(this.__inspectOptions, ...args);
      }
    }

    const cdsData = this.__cdsContext
      ? {
          [FIELD.CORRELATION_ID]: this.__cdsContext.id,
          [FIELD.TENANT_ID]: this.__cdsContext.tenant,
        }
      : undefined;
    const now = new Date();
    const invocationData = {
      [FIELD.LEVEL]: level,
      [FIELD.WRITTEN_AT]: now.toISOString(),
      [FIELD.WRITTEN_TIME]: now.getTime(),
      [FIELD.MESSAGE]: message ?? "",
    };
    return Object.assign(
      {},
      cfAppData,
      ...this.__dataList,
      invocationErrorData,
      invocationData,
      this.__baseData,
      cdsData
    );
  }

  static _readableOutput(data) {
    const writtenTime = new Date(data[FIELD.WRITTEN_TIME]);
    const timestamp = util.format(
      "%s:%s:%s.%s",
      ("0" + writtenTime.getHours()).slice(-2),
      ("0" + writtenTime.getMinutes()).slice(-2),
      ("0" + writtenTime.getSeconds()).slice(-2),
      ("00" + writtenTime.getMilliseconds()).slice(-3)
    );
    const level = data[FIELD.LEVEL];
    const layer = data[FIELD.LAYER];
    const message = data[FIELD.MESSAGE];
    const errorInfo = data[FIELD.ERROR_INFO];
    const parts = [timestamp, level, ...(layer ? [layer] : []), ...(errorInfo ? [errorInfo] : []), message];
    return parts.join(" | ");
  }

  _log(level, args) {
    // check if level should be logged
    if (this.__levelNumber < LEVEL_NUMBER[level]) {
      return;
    }
    const streamOut = level === LEVEL.ERROR ? process.stderr : process.stdout;
    const data = this._logData(level, args);
    if (this.__readable) {
      streamOut.write(Logger._readableOutput(data) + "\n");
    } else {
      streamOut.write(JSON.stringify(data) + "\n");
    }
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

module.exports = {
  LEVEL,

  Logger,
};
