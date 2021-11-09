"use strict";

const isNull = (...args) => args.reduce((result, arg) => result || arg === undefined || arg === null, false);

module.exports = {
  isNull,
};
