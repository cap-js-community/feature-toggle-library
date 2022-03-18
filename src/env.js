"use strict";

const VError = require("verror");
const { ENV } = require("./helper");
const { Logger } = require("./logger");

const COMPONENT_NAME = "/Env";
const VERROR_CLUSTER_NAME = "Env";
const logger = Logger(COMPONENT_NAME);

const isLocal = process.env[ENV.USER] !== "vcap";
const isOnCF = !isLocal;

class CfEnv {
  static parseEnvVar(env, envVar) {
    try {
      if (Object.prototype.hasOwnProperty.call(env, envVar)) {
        return JSON.parse(process.env[envVar]);
      }
    } catch (err) {
      logger.error(
        new VError(
          {
            name: VERROR_CLUSTER_NAME,
            cause: err,
            info: {
              envVar,
            },
          },
          "environment variable is not valid JSON"
        )
      );
    }
  }

  constructor(env = process.env) {
    this.__cfApp = CfEnv.parseEnvVar(env, ENV.CF_APP) || {};
    this.__cfServices = CfEnv.parseEnvVar(env, ENV.CF_SERVICES) || {};
  }

  cfApp() {
    return this.__cfApp;
  }

  cfServices() {
    return this.__cfServices;
  }

  cfServiceCredentials(options) {
    const serivce = []
      .concat(...Object.values(this.__cfServices))
      .find((service) =>
        Object.entries(options).reduce((result, [key, value]) => result && service[key] === value, true)
      );
    if (serivce && serivce.credentials) {
      return serivce.credentials;
    }
    return {};
  }
}

module.exports = {
  isLocal,
  isOnCF,
  cfEnv: new CfEnv(),
};
