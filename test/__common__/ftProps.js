"use strict";

const { FeatureToggles } = jest.requireActual("../../src/featureToggles");
const singleton = jest.requireActual("../../src/singleton");

const IGNORE_PROPERTIES = ["constructor", "length", "name", "prototype", "getInstance"];

const ftInstanceProps = Object.getOwnPropertyNames(FeatureToggles.prototype).filter(
  (prop) => !IGNORE_PROPERTIES.includes(prop) && !prop.startsWith("_")
);
const ftClassProps = Object.getOwnPropertyNames(FeatureToggles).filter(
  (prop) => !IGNORE_PROPERTIES.includes(prop) && !prop.startsWith("_")
);
const ftProps = [].concat(ftClassProps, ftInstanceProps);

const singletonProps = Object.keys(singleton).filter((p) => !p.startsWith("_"));

module.exports = {
  IGNORE_PROPERTIES,

  ftInstanceProps,
  ftClassProps,
  ftProps,
  singletonProps,
};
