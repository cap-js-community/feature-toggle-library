"use strict";

let cfEnv = {};
const _reset = () => {
  cfEnv.isOnCf = false;
  cfEnv.cfApp = {};
  cfEnv.cfServices = {};
  cfEnv.cfServiceCredentialsForLabel = jest.fn().mockReturnValue({});
};
_reset();

module.exports = {
  cfEnv,
  _reset,
};
