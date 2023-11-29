// https://cap.cloud.sap/docs/node.js/cds-plugins
"use strict";

const cds = require("@sap/cds");
const cdsPackage = require("@sap/cds/package.json");
const toggles = require("./src/");
const { closeMainClient, closeSubscriberClient } = require("./src/redisWrapper");

const FEATURE_KEY_REGEX = /\/fts\/([^\s/]+)$/;

const _overwriteServiceAccessRoles = (envFeatureToggles) => {
  if (!Array.isArray(envFeatureToggles.serviceAccessRoles)) {
    return;
  }
  cds.on("loaded", (csn) => {
    if (csn.definitions.FeatureService) {
      csn.definitions.FeatureService["@requires"] = envFeatureToggles.serviceAccessRoles;
    }
  });
};

const _registerFeatureProvider = () => {
  if (!cds.env.requires?.toggles) {
    return;
  }
  const cdsFeatures = toggles.getFeaturesKeys().reduce((result, key) => {
    const match = FEATURE_KEY_REGEX.exec(key);
    if (match) {
      const feature = match[1];
      result.push([key, feature]);
    }
    return result;
  }, []);
  if (cdsFeatures.length === 0) {
    return;
  }
  cds.middlewares.add(
    function cds_feature_provider(req, res, next) {
      const user = cds.context?.user?.id;
      const tenant = cds.context?.tenant;
      req.features =
        req.headers.features ||
        cds.context?.user?.features ||
        cdsFeatures.reduce((result, [key, feature]) => {
          if (toggles.getFeatureValue(key, { user, tenant })) {
            result.push(feature);
          }
          return result;
        }, []);
      next();
    },
    { before: "ctx_model" }
  );
};

const _registerClientCloseOnShutdown = () => {
  cds.on("shutdown", async () => {
    await Promise.allSettled([closeMainClient(), closeSubscriberClient()]);
  });
};

const activate = async () => {
  const envFeatureToggles = cds.env.featureToggles;
  if (!envFeatureToggles?.config && !envFeatureToggles?.configFile) {
    return;
  }
  _overwriteServiceAccessRoles(envFeatureToggles);
  _registerClientCloseOnShutdown();

  // TODO for the "cds build" use case, this initialize makes no sense
  await toggles.initializeFeatures({
    config: envFeatureToggles.config,
    configFile: envFeatureToggles.configFile,
  });

  _registerFeatureProvider();
};

// NOTE: for sap/cds < 7.3.0 it was expected to export activate as function property, otherwise export the promise of
//   running activate
const doExportActivateAsProperty =
  cdsPackage.version.localeCompare("7.3.0", undefined, { numeric: true, sensitivity: "base" }) < 0;

module.exports = doExportActivateAsProperty
  ? {
      activate,
    }
  : activate();
