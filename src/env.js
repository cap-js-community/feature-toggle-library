"use strict";

const VError = require("verror");

const { Logger } = require("./logger");
const { ENV } = require("./shared/static");

const COMPONENT_NAME = "/Env";
const VERROR_CLUSTER_NAME = "Env";

const isLocal = process.env[ENV.USER] !== "vcap";
const isOnCF = !isLocal;

const logger = new Logger(COMPONENT_NAME, isOnCF);

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
    this.__cfServiceList = [].concat(...Object.values(this.__cfServices));
    this.__cfServiceLabelMap = this.__cfServiceList.reduce((result, service) => {
      if (service.label && !result[service.label]) {
        result[service.label] = service;
      }
      return result;
    }, {});
  }

  static getInstance() {
    if (!CfEnv.__instance) {
      CfEnv.__instance = new CfEnv();
    }
    return CfEnv.__instance;
  }

  cfApp() {
    return this.__cfApp;
  }

  cfServices() {
    return this.__cfServices;
  }

  cfServiceCredentials(options) {
    const service = this.__cfServiceList.find((service) =>
      Object.entries(options).reduce((result, [key, value]) => result && service[key] === value, true)
    );
    return service && service.credentials ? service.credentials : {};
  }

  cfServiceCredentialsForLabel(label) {
    const service = this.__cfServiceLabelMap[label];
    return service && service.credentials ? service.credentials : {};
  }
}

module.exports = {
  isLocal,
  isOnCF,
  cfEnv: CfEnv.getInstance(),
};
