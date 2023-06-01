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
  getScopeKey: FeatureToggles.getScopeKey.bind(FeatureToggles),
  getScopeMap: FeatureToggles.getScopeMap.bind(FeatureToggles),
  validateFeatureValue: instance.validateFeatureValue.bind(instance),
  initializeFeatures: instance.initializeFeatures.bind(instance),
  getFeatureInfo: instance.getFeatureInfo.bind(instance),
  getFeaturesInfos: instance.getFeaturesInfos.bind(instance),
  getFeatureValue: instance.getFeatureValue.bind(instance),
  refreshFeatureValues: instance.refreshFeatureValues.bind(instance),
  changeFeatureValue: instance.changeFeatureValue.bind(instance),
  resetFeatureValue: instance.resetFeatureValue.bind(instance),
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
