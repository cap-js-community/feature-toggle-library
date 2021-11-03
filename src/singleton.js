"use strict";

const { FeatureToggles } = require("./featureToggles");
const { cfApp } = require("./env");

const _uniqueNameFromCfApp = () => {
  try {
    const { application_name } = cfApp();
    return application_name;
  } catch (err) {
    return null;
  }
};

const instance = new FeatureToggles({ uniqueName: _uniqueNameFromCfApp() });
const exportObject = Object.fromEntries(
  Object.getOwnPropertyNames(FeatureToggles.prototype)
    .filter((member) => member !== "constructor")
    .map((member) => [member, instance[member].bind(instance)])
);

module.exports = exportObject;
