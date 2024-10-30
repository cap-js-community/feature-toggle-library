"use strict";

const fs = require("fs");
const { promisify } = require("util");

const accessAsync = promisify(fs.access);

const isNull = (...args) => args.reduce((result, arg) => result || arg === undefined || arg === null, false);

const isObject = (input) => typeof input === "object" && input !== null;

const tryRequire = (module) => {
  try {
    return require(module);
  } catch (err) {} // eslint-disable-line no-empty
};

const tryJsonParse = (...args) => {
  try {
    return JSON.parse(...args);
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
  isNull,
  isObject,
  tryRequire,
  tryJsonParse,
  pathReadable,
  tryPathReadable,
};
