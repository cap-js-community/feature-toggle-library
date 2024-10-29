"use strict";

const _transformToFromInfos = (fromInfo) => (featureInfos) =>
  Object.fromEntries(Object.entries(featureInfos).map(([key, featureInfo]) => [key, fromInfo(featureInfo)]));

const fallbackValuesFromInfo = ({ fallbackValue }) => fallbackValue;

const stateFromInfo = ({ rootValue, scopedValues }) => ({
  ...(rootValue !== undefined && { rootValue }),
  ...(scopedValues && { scopedValues }),
});

module.exports = {
  fallbackValuesFromInfo,
  fallbackValuesFromInfos: _transformToFromInfos(fallbackValuesFromInfo),
  stateFromInfo,
  stateFromInfos: _transformToFromInfos(stateFromInfo),
};
