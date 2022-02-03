"use strict";

const VError = require("verror");
const xsenv = require("@sap/xsenv");
const { ENV } = require("./helper");

const VERROR_CLUSTER_NAME = "Env";

const isLocal = process.env[ENV.USER] !== "vcap";
const isOnCF = !isLocal;

let cfAppCache = null;

const cfServiceCredentials = xsenv.cfServiceCredentials;

const cfApp = () => {
  if (!cfAppCache) {
    try {
      cfAppCache = Object.prototype.hasOwnProperty.call(process.env, ENV.CF_APP)
        ? JSON.parse(process.env[ENV.CF_APP])
        : {};
    } catch (err) {
      throw new VError(
        {
          name: VERROR_CLUSTER_NAME,
          cause: err,
        },
        "environment variable %s is not valid JSON",
        ENV.CF_APP
      );
    }
  }
  return cfAppCache;
};

module.exports = {
  isLocal,
  isOnCF,
  cfServiceCredentials,
  cfApp,
};
