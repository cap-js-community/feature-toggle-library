"use strict";

const VError = require("verror");
const xsenv = require("@sap/xsenv");

const CF_APP_ENV = "VCAP_APPLICATION";
const VERROR_CLUSTER_NAME = "Env";

const isLocal = process.env.USER !== "vcap";
const isOnCF = !isLocal;

let cfAppCache = null;

const cfServiceCrentials = xsenv.cfServiceCredentials;

const cfApp = () => {
  if (!cfAppCache) {
    try {
      cfAppCache = Object.prototype.hasOwnProperty.call(process.env, CF_APP_ENV)
        ? JSON.parse(process.env[CF_APP_ENV])
        : {};
    } catch (err) {
      throw new VError(
        {
          name: VERROR_CLUSTER_NAME,
          cause: err,
        },
        "environment variable %s is not valid JSON",
        CF_APP_ENV
      );
    }
  }
  return cfAppCache;
};

module.exports = {
  isLocal,
  isOnCF,
  cfServiceCrentials,
  cfApp,
};
