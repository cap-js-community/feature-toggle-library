"use strict";

class CfEnv {
  _reset() {
    this.isOnCf = false;
    this.cfApp = {};
    this.cfServices = {};
    this.cfServiceCredentialsForLabel = jest.fn().mockReturnValue({});
  }
  constructor() {
    this._reset();
  }
  static getInstance() {
    if (!CfEnv.__instance) {
      CfEnv.__instance = new CfEnv();
    }
    return CfEnv.__instance;
  }
}

module.exports = { CfEnv };
