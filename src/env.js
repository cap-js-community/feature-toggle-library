"use strict";

const { ENV } = require("./shared/static");

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
   * @return CfEnv
   */
  static get instance() {
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

const cfEnv = CfEnv.instance;

module.exports = cfEnv;
