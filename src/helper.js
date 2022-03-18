"use strict";

const ENV = Object.freeze({
  USER: "USER",
  CF_APP: "VCAP_APPLICATION",
  CF_SERVICES: "VCAP_SERVICES",
  UNIQUE_NAME: "BTP_FEATURES_UNIQUE_NAME",
  KEY: "BTP_FEATURES_KEY",
  CHANNEL: "BTP_FEATURES_CHANNEL",
});

const isNull = (...args) => args.reduce((result, arg) => result || arg === undefined || arg === null, false);

module.exports = {
  ENV,
  isNull,
};
