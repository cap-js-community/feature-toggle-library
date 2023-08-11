"use strict";

let cfEnv;
let isOnCF;

const _reset = () => {
  isOnCF = false;
  cfEnv = {
    cfApp: {},
    cfServices: {},
  };
};
_reset();

module.exports = {
  cfEnv,
  isOnCF,
  _reset,
};
