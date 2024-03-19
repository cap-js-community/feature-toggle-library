// https://cap.cloud.sap/docs/node.js/cds-plugins
"use strict";

const { promisify } = require("util");
const fs = require("fs");
const pathlib = require("path");

const cds = require("@sap/cds");
const cdsPackage = require("@sap/cds/package.json");
const toggles = require("./src/");
const { closeMainClient, closeSubscriberClient } = require("./src/redisWrapper");
const { tryRequire } = require("./src/shared/static");

const FEATURE_KEY_REGEX = /\/fts\/([^\s/]+)$/;
const FTS_AUTO_CONFIG = {
  type: "boolean",
  fallbackValue: false,
};

const readDirAsync = promisify(fs.readdir);

const doEnableHeaderFeatures = cds.env.profiles?.includes("development");
const isBuild = cds.build?.register;

const _overwriteUniqueName = (envFeatureToggles) => {
  const uniqueName = envFeatureToggles?.uniqueName;
  if (!uniqueName) {
    return;
  }
  toggles._reset({ uniqueName });
};

const _overwriteServiceAccessRoles = (envFeatureToggles) => {
  if (!Array.isArray(envFeatureToggles?.serviceAccessRoles)) {
    return;
  }
  cds.on("loaded", (csn) => {
    if (csn.definitions.FeatureService) {
      csn.definitions.FeatureService["@requires"] = envFeatureToggles.serviceAccessRoles;
    }
  });
};

const _registerFeatureProvider = (envFeatureToggles) => {
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

  const defaultFtsScopeCallback = (context, key) => ({ user: context?.user?.id, tenant: context?.tenant });
  const ftsScopeCallback = envFeatureToggles?.ftsScopeCallback
    ? tryRequire(envFeatureToggles?.ftsScopeCallback)
    : defaultFtsScopeCallback;

  const _getReqFeatures = (req) => {
    if (doEnableHeaderFeatures && req.headers.features) {
      return req.headers.features;
    }
    if (cds.context?.user?.features) {
      return cds.context.user.features;
    }
    return cdsFeatures.reduce((result, [key, feature]) => {
      if (toggles.getFeatureValue(key, ftsScopeCallback(cds.context, key))) {
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

const _discoverFtsAutoConfig = async () => {
  const root = process.env.ROOT ?? process.cwd();
  const ftsRoot = pathlib.join(root, "fts");
  let result;
  try {
    result = (await readDirAsync(ftsRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .reduce((acc, curr) => {
        const key = `/fts/${curr.name}`; // NOTE: this has to match FEATURE_KEY_REGEX
        acc[key] = Object.assign({}, FTS_AUTO_CONFIG);
        return acc;
      }, {});
  } catch (err) {} // eslint-disable-line no-empty
  return result;
};

const activate = async () => {
  const envFeatureToggles = cds.env.featureToggles;
  const ftsAutoConfig = await _discoverFtsAutoConfig();
  if (!envFeatureToggles?.config && !envFeatureToggles?.configFile && !ftsAutoConfig) {
    return;
  }
  _overwriteUniqueName(envFeatureToggles);
  _overwriteServiceAccessRoles(envFeatureToggles);
  _registerClientCloseOnShutdown();

  if (isBuild) {
    return;
  }
  await toggles.initializeFeatures({
    config: envFeatureToggles?.config,
    configFile: envFeatureToggles?.configFile,
    configAuto: ftsAutoConfig,
  });

  _registerFeatureProvider(envFeatureToggles);
};

// NOTE: for sap/cds < 7.3.0 it was expected to export activate as function property, otherwise export the promise of
//   running activate
const doExportActivateAsProperty =
  cdsPackage.version.localeCompare("7.3.0", undefined, { numeric: true, sensitivity: "base" }) < 0;

module.exports = doExportActivateAsProperty ? { activate } : activate();
