"use strict";

const { ENV } = require("./shared/static");

const isLocal = process.env[ENV.USER] !== "vcap";
const isOnCF = !isLocal;

class CfEnv {
  static parseEnvVar(env, envVar) {
    try {
      if (Object.prototype.hasOwnProperty.call(env, envVar)) {
        return JSON.parse(process.env[envVar]);
      }
    } catch (err) {} // eslint-disable-line no-empty
  }

  constructor(env = process.env) {
    this.__cfApp = CfEnv.parseEnvVar(env, ENV.CF_APP) || {};
    this.__cfServices = CfEnv.parseEnvVar(env, ENV.CF_SERVICES) || {};
    this.__cfInstanceGuid = env[ENV.CF_INSTANCE_GUID];
    this.__cfInstanceIp = env[ENV.CF_INSTANCE_IP];
    this.__cfInstanceIndex = env[ENV.CF_INSTANCE_INDEX];
    this.__cfServiceList = [].concat(...Object.values(this.__cfServices));
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
  static getInstance() {
    if (!CfEnv.__instance) {
      CfEnv.__instance = new CfEnv();
    }
    return CfEnv.__instance;
  }

  // NOTE: we have these getters just for mocking, which violates the principle to not change production code just for
  //   tests. Instead of using class getters, you could also do the getters in an Object.defineProperty(), but that
  //   violates the same principle. With object properties that have values without getters, the jest.spyOn approach
  //   does not work. So, you would have to mock the whole class instance for tests.
  get cfApp() {
    return this.__cfApp;
  }

  get cfServices() {
    return this.__cfServices;
  }

  get cfInstanceGuid() {
    return this.__cfInstanceGuid;
  }

  get cfInstanceIp() {
    return this.__cfInstanceIp;
  }

  get cfInstanceIndex() {
    return this.__cfInstanceIndex;
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
  CfEnv,

  isLocal,
  isOnCF,
  cfEnv: CfEnv.getInstance(),
};
