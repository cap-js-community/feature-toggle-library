"use strict";
const util = require("util");
const VError = require("verror");

const { cfEnv, isOnCF } = require("./env");
const { tryRequire } = require("./shared/static");

// NOTE: logger levels are tricky. looking at console, npm, winston, and cap there is no real consistency. we will
//   offer the same levels as console and an additional "off" level.
const LEVEL = Object.freeze({
  OFF: "OFF", // SILENT: "SILENT"
  ERROR: "ERROR",
  WARNING: "WARNING",
  INFO: "INFO",
  DEBUG: "DEBUG", // VERBOSE: "VERBOSE",
  TRACE: "TRACE", // SILLY: "SILLY"
});

const LEVEL_NUMBER = Object.freeze({
  [LEVEL.OFF]: 0,
  [LEVEL.ERROR]: 100,
  [LEVEL.WARNING]: 200,
  [LEVEL.INFO]: 300,
  [LEVEL.DEBUG]: 400,
  [LEVEL.TRACE]: 500,
});

const LEVEL_NAME = Object.freeze({
  [LEVEL.ERROR]: "error",
  [LEVEL.WARNING]: "warn", // NOTE: cf-nodejs-logging-support started using warn instead of warning, and now we cannot change it
  [LEVEL.INFO]: "info",
  [LEVEL.DEBUG]: "debug",
  [LEVEL.TRACE]: "trace",
});

const FIELD = Object.freeze({
  // CF ENV DATA
  COMPONENT_NAME: "component_name",
  COMPONENT_ID: "component_id",
  COMPONENT_INSTANCE: "component_instance",
  COMPONENT_TYPE: "component_type",
  SPACE_NAME: "space_name",
  SPACE_ID: "space_id",
  ORGANIZATION_NAME: "organization_name",
  ORGANIZATION_ID: "organization_id",
  CONTAINER_ID: "container_id",

  // BASE DATA
  TYPE: "type",
  LAYER: "layer",

  // ASYNC_LOCAL_STORAGE CDS CONTEXT DATA
  CORRELATION_ID: "correlation_id",
  REMOTE_USER: "remote_user",
  TENANT_ID: "tenant_id",
  TENANT_SUBDOMAIN: "tenant_subdomain",

  // LOG INVOCATION DATA
  LEVEL: "level",
  WRITTEN_AT: "written_at",
  WRITTEN_TIME: "written_ts",
  MESSAGE: "msg",
});

const FORMAT = Object.freeze({
  JSON: "JSON",
  TEXT: "TEXT",
});

const MILLIS_IN_NANOS_NUMBER = 1000000;
const MILLIS_IN_NANOS_BIGINT = BigInt(MILLIS_IN_NANOS_NUMBER);

const cds = tryRequire("@sap/cds");
const cfApp = cfEnv.cfApp;
const cfAppData = isOnCF
  ? {
      [FIELD.COMPONENT_TYPE]: "application",
      [FIELD.COMPONENT_NAME]: cfApp.application_name,
      [FIELD.COMPONENT_ID]: cfApp.application_id,
      [FIELD.COMPONENT_INSTANCE]: cfEnv.cfInstanceIndex,
      [FIELD.SPACE_NAME]: cfApp.space_name,
      [FIELD.SPACE_ID]: cfApp.space_id,
      [FIELD.ORGANIZATION_NAME]: cfApp.organization_name,
      [FIELD.ORGANIZATION_ID]: cfApp.organization_id,
      [FIELD.CONTAINER_ID]: cfEnv.cfInstanceIp,
    }
  : undefined;

class Logger {
  constructor(
    layer = undefined,
    {
      type = "log",
      maxLevel = LEVEL.INFO,
      customData,
      format = isOnCF ? FORMAT.JSON : FORMAT.TEXT,
      inspectOptions = { colors: false },
    } = {}
  ) {
    this.__baseData = {
      [FIELD.TYPE]: type,
      [FIELD.LAYER]: layer,
    };
    this.__dataList = customData ? [customData] : [];
    this.__format = format;
    this.__inspectOptions = inspectOptions;
    this.__maxLevelNumber = LEVEL_NUMBER[maxLevel];
  }

  child(data) {
    const child = new Logger();
    Object.assign(child, this);
    // NOTE: object.assign only does a shallow copy, so changes to __dataList would propagate to the children. to avoid
    //   this it needs to be cloned here.
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
        const errInfo = VError.info(err);
        if (errInfo && Object.keys(errInfo).length > 0) {
          message = util.formatWithOptions(this.__inspectOptions, "%s\n%O", VError.fullStack(err), errInfo);
        } else {
          message = util.formatWithOptions(this.__inspectOptions, "%s", VError.fullStack(err));
        }
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

    const cdsContext = cds?.context;
    const req = cdsContext?.http?.req;
    const cdsData = cdsContext
      ? {
          [FIELD.CORRELATION_ID]: cdsContext.id,
          [FIELD.REMOTE_USER]: cdsContext.user?.id,
          [FIELD.TENANT_ID]: cdsContext.tenant,
          [FIELD.TENANT_SUBDOMAIN]: req?.authInfo?.getSubdomain?.(),
        }
      : undefined;
    // NOTE: the start time of Date's milliseconds is the epoch and the start time for hrtime is an arbitrary time
    //   close to the process startup, so it may look odd to add them here. however, we can use the sub-millisecond
    //   offset of hrtime to keep logs with the same Date-millisecond in chronological order.
    const now = new Date();
    const nowNanos = now.getTime() * MILLIS_IN_NANOS_NUMBER + Number(process.hrtime.bigint() % MILLIS_IN_NANOS_BIGINT);
    const invocationData = {
      [FIELD.LEVEL]: LEVEL_NAME[level],
      [FIELD.WRITTEN_AT]: now.toISOString(),
      [FIELD.WRITTEN_TIME]: nowNanos,
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
    const writtenTime = new Date(Math.floor(data[FIELD.WRITTEN_TIME] / MILLIS_IN_NANOS_NUMBER));
    const timestamp = util.format(
      "%s:%s:%s.%s",
      ("0" + writtenTime.getHours()).slice(-2),
      ("0" + writtenTime.getMinutes()).slice(-2),
      ("0" + writtenTime.getSeconds()).slice(-2),
      ("00" + writtenTime.getMilliseconds()).slice(-3)
    );
    const level = data[FIELD.LEVEL].toUpperCase();
    const layer = data[FIELD.LAYER];
    const message = data[FIELD.MESSAGE];
    const parts = [timestamp, level, ...(layer ? [layer] : []), message];
    return parts.join(" | ");
  }

  _log(level, args) {
    if (this.__maxLevelNumber < LEVEL_NUMBER[level]) {
      return;
    }
    const streamOut = level === LEVEL.ERROR ? process.stderr : process.stdout;
    const data = this._logData(level, args);
    switch (this.__format) {
      case FORMAT.JSON: {
        streamOut.write(JSON.stringify(data) + "\n");
        break;
      }
      case FORMAT.TEXT: {
        streamOut.write(Logger._readableOutput(data) + "\n");
        break;
      }
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
  FORMAT,

  Logger,
};
