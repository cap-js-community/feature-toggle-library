"use strict";

const fs = require("fs");
const { promisify } = require("util");

const accessAsync = promisify(fs.access);

const ENV = Object.freeze({
  USER: "USER",
  CF_APP: "VCAP_APPLICATION",
  CF_SERVICES: "VCAP_SERVICES",
  CF_INSTANCE_GUID: "CF_INSTANCE_GUID",
  CF_INSTANCE_IP: "CF_INSTANCE_IP",
  CF_INSTANCE_INDEX: "CF_INSTANCE_INDEX",
  UNIQUE_NAME: "BTP_FEATURES_UNIQUE_NAME",
  REDIS_KEY: "BTP_FEATURES_REDIS_KEY",
  REDIS_CHANNEL: "BTP_FEATURES_REDIS_CHANNEL",
  LOG_LEVEL: "BTP_FEATURES_LOG_LEVEL",
});

const isNull = (...args) => args.reduce((result, arg) => result || arg === undefined || arg === null, false);

const isObject = (input) => typeof input === "object" && input !== null;

const tryRequire = (module) => {
  try {
    return require(module);
  } catch (err) {} // eslint-disable-line no-empty
};

const pathReadable = async (path) => (await accessAsync(path, fs.constants.R_OK)) ?? true;

const tryPathReadable = async (path) => {
  try {
    return await pathReadable(path);
  } catch (err) {
    return false;
  }
};

module.exports = {
  ENV,
  isNull,
  isObject,
  tryRequire,
  pathReadable,
  tryPathReadable,
};
