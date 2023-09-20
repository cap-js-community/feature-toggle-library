"use strict";

let isOnCF;
let cfEnv;
const _reset = () => {
  isOnCF = false;
  cfEnv = {
    cfApp: {},
    cfServices: {},
    cfServiceCredentialsForLabel: jest.fn().mockReturnValue({}),
  };
};
_reset();

module.exports = {
  cfEnv,
  isOnCF,
  _reset,
};
