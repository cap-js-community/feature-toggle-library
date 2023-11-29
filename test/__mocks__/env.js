"use strict";

const cfEnv = {
  _reset() {
    this.isOnCf = false;
    this.cfApp = {};
    this.cfServices = {};
    this.cfServiceCredentialsForLabel = jest.fn().mockReturnValue({});
  },
};
cfEnv._reset();

module.exports = cfEnv;
