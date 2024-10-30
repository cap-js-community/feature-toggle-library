"use strict";

class CfEnvMock {
  _reset() {
    this.isOnCf = false;
    this.cfApp = {};
    this.cfServices = {};
  }

  constructor() {
    this._reset();
  }

  cfServiceCredentialsForLabel = jest.fn().mockReturnValue({});

  static getInstance() {
    if (!CfEnvMock.__instance) {
      CfEnvMock.__instance = new CfEnvMock();
    }
    return CfEnvMock.__instance;
  }
}

module.exports = {
  CfEnv: CfEnvMock,
};
