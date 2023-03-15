"use strict";

const { FeatureToggles } = require("./featureToggles");
const { cfEnv } = require("./env");
const { ENV } = require("./shared/static");

const _uniqueNameFromEnv = process.env[ENV.UNIQUE_NAME] || null;

const _uniqueNameFromCfApp = () => {
  try {
    const { application_name } = cfEnv.cfApp();
    return application_name;
  } catch (err) {
    return null;
  }
};

const instance = new FeatureToggles({ uniqueName: _uniqueNameFromEnv || _uniqueNameFromCfApp() });
module.exports = {
  validateInput: instance.validateInput.bind(instance),
  refreshFeatureValues: instance.refreshFeatureValues.bind(instance),
  initializeFeatureValues: instance.initializeFeatureValues.bind(instance),
  getFeatureState: instance.getFeatureState.bind(instance),
  getFeatureStates: instance.getFeatureStates.bind(instance),
  getFeatureValue: instance.getFeatureValue.bind(instance),
  getFeatureValues: instance.getFeatureValues.bind(instance),
  changeFeatureValue: instance.changeFeatureValue.bind(instance),
  changeFeatureValues: instance.changeFeatureValues.bind(instance),
  registerFeatureValueChangeHandler: instance.registerFeatureValueChangeHandler.bind(instance),
  removeFeatureValueChangeHandler: instance.removeFeatureValueChangeHandler.bind(instance),
  removeAllFeatureValueChangeHandlers: instance.removeAllFeatureValueChangeHandlers.bind(instance),
  registerFeatureValueValidation: instance.registerFeatureValueValidation.bind(instance),
  removeFeatureValueValidation: instance.removeFeatureValueValidation.bind(instance),
  removeAllFeatureValueValidation: instance.removeAllFeatureValueValidation.bind(instance),
  _: {
    _instance: () => instance,
  },
};
