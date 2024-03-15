// https://cap.cloud.sap/docs/node.js/cds-plugins
"use strict";

const cds = require("@sap/cds");
const cdsPackage = require("@sap/cds/package.json");
const toggles = require("./src/");
const { closeMainClient, closeSubscriberClient } = require("./src/redisWrapper");
const { tryFileReadable } = require("./src/shared/static");

const FEATURE_KEY_REGEX = /\/fts\/([^\s/]+)$/;

const FeatureToggles = toggles.FeatureToggles;
const doEnableHeaderFeatures = cds.env.profiles?.includes("development");
const isBuild = cds.build?.register;

const _overwriteUniqueName = (envFeatureToggles) => {
  const uniqueName = envFeatureToggles.uniqueName;
  if (!uniqueName) {
    return;
  }
  toggles._reset({ uniqueName });
};

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

  const _getReqFeatures = (req) => {
    if (doEnableHeaderFeatures && req.headers.features) {
      return req.headers.features;
    }
    if (cds.context?.user?.features) {
      return cds.context.user.features;
    }
    const user = cds.context?.user?.id;
    const tenant = cds.context?.tenant;
    return cdsFeatures.reduce((result, [key, feature]) => {
      if (toggles.getFeatureValue(key, { user, tenant })) {
        result.push(feature);
      }
      return result;
    }, []);
  };
  cds.middlewares.add(
    function cds_feature_provider(req, res, next) {
      req.features = _getReqFeatures(req);
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

const _consolidateConfig = async (envFeatureToggles) => {
  const configFromFile = (await tryFileReadable(envFeatureToggles.configFile))
    ? await FeatureToggles.readConfigFromFile(envFeatureToggles.configFile)
    : undefined;
  return Object.assign(ftsConfig, configFromFile, envFeatureToggles.config);
};

const activate = async () => {
  const envFeatureToggles = cds.env.featureToggles;
  const config = await _consolidateConfig(envFeatureToggles);
  if (!Object.keys(config).length) {
    return;
  }

  _overwriteUniqueName(envFeatureToggles);
  _overwriteServiceAccessRoles(envFeatureToggles);
  _registerClientCloseOnShutdown();

  if (isBuild) {
    return;
  }

  await toggles.initializeFeatures({ config });

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
