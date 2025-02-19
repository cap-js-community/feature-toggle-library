"use strict";

const ENV = Object.freeze({
  USER: "USER",
  CF_APP: "VCAP_APPLICATION",
  CF_SERVICES: "VCAP_SERVICES",
  CF_INSTANCE_GUID: "CF_INSTANCE_GUID",
  CF_INSTANCE_IP: "CF_INSTANCE_IP",
  CF_INSTANCE_INDEX: "CF_INSTANCE_INDEX",
});

/**
 * CfEnv is a singleton class to interact with the Cloud Foundry environment variables.
 */
class CfEnv {
  static __instance;

  static parseEnvVar(env, envVar) {
    try {
      if (Object.prototype.hasOwnProperty.call(env, envVar)) {
        return JSON.parse(process.env[envVar]);
      }
    } catch (err) {} // eslint-disable-line no-empty
  }

  constructor(env = process.env) {
    if (env.NODE_ENV !== "production" && env.USE_DEFAULT_ENV) {
      try {
        const { VCAP_APPLICATION, VCAP_SERVICES } = require(process.cwd() + "/default-env.json");
        if (VCAP_APPLICATION && !Object.prototype.hasOwnProperty.call(env, "VCAP_APPLICATION")) {
          env.VCAP_APPLICATION = JSON.stringify(VCAP_APPLICATION);
        }
        if (VCAP_SERVICES && !Object.prototype.hasOwnProperty.call(env, "VCAP_SERVICES")) {
          env.VCAP_SERVICES = JSON.stringify(VCAP_SERVICES);
        }
      } catch (err) {} // eslint-disable-line no-empty
    }

    this.isOnCf = env[ENV.USER] === "vcap";
    this.cfApp = CfEnv.parseEnvVar(env, ENV.CF_APP) || {};
    this.cfServices = CfEnv.parseEnvVar(env, ENV.CF_SERVICES) || {};
    this.cfInstanceGuid = env[ENV.CF_INSTANCE_GUID];
    this.cfInstanceIp = env[ENV.CF_INSTANCE_IP];
    this.cfInstanceIndex = env[ENV.CF_INSTANCE_INDEX] ? parseInt(env[ENV.CF_INSTANCE_INDEX]) : undefined;
    this.__cfServiceList = [].concat(...Object.values(this.cfServices));
    this.__cfServiceLabelMap = this.__cfServiceList.reduce((result, service) => {
      if (service.label && !result[service.label]) {
        result[service.label] = service;
      }
      return result;
    }, {});
  }

  /**
   * @returns {CfEnv}
   */
  static getInstance() {
    if (!CfEnv.__instance) {
      CfEnv.__instance = new CfEnv();
    }
    return CfEnv.__instance;
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
  ENV,
  CfEnv,
};
