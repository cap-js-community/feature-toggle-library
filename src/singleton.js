"use strict";

const { FeatureToggles } = require("./featureToggles");

const instance = FeatureToggles.getInstance();
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
};
