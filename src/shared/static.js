"use strict";

const ENV = Object.freeze({
  USER: "USER",
  CF_APP: "VCAP_APPLICATION",
  CF_SERVICES: "VCAP_SERVICES",
  UNIQUE_NAME: "BTP_FEATURES_UNIQUE_NAME",
  REDIS_KEY: "BTP_FEATURES_REDIS_KEY",
  REDIS_CHANNEL: "BTP_FEATURES_REDIS_CHANNEL",
});

const isNull = (...args) => args.reduce((result, arg) => result || arg === undefined || arg === null, false);

const isObject = (input) => typeof input === "object" && input === null;

module.exports = {
  ENV,
  isNull,
  isObject,
};
