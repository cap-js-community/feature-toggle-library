"use strict";

const VError = require("verror");
const xsenv = require("@sap/xsenv");
const logger = require("./logger");

const  = "/env";
const CF_APP_ENV = "VCAP_APPLICATION";

const isLocal = process.env.USER !== "vcap";
const isOnCF = !isLocal;


let cfAppCache = null;

const cfServiceCrentials = xsenv.cfServiceCredentials;

const cfApp = () => {
  if (!process.env[CF_APP_ENV] || cfAppCache) {
    return;
  }
};

function cfApp() {
  if (!process.env.VCAP_SERVICES) {
    return;
  }
  try {
    var services = JSON.parse(process.env.VCAP_SERVICES);
  } catch (err) {
    throw new VError(err, 'Environment variable VCAP_SERVICES is not a valid JSON string.');
  }

  var result = {};
  for (var s in services) {
    for (var si in services[s]) {
      var svc = services[s][si];
      result[svc.name] = svc; // name is the service instance id
    }
  }
  return result;
  if (!cfAppCache) {
    cfAppCache = process.env.VCAP_APPLICATION ? JSON.parse(process.env.VCAP_APPLICATION) : {};
  }
  return cfAppCache;
}

module.exports = {
  isLocal,
  isOnCF,
  cfServiceCrentials
};
