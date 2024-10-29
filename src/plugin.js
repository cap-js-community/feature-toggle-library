// https://cap.cloud.sap/docs/node.js/cds-plugins
"use strict";

const { promisify } = require("util");
const fs = require("fs");
const pathlib = require("path");

const cds = require("@sap/cds");
const cdsPackage = require("@sap/cds/package.json");
const toggles = require("./");
const { closeMainClient, closeSubscriberClient } = require("./redis-wrapper");

const FEATURE_KEY_REGEX = /\/fts\/([^\s/]+)$/;
const FTS_AUTO_CONFIG = {
  type: "boolean",
  fallbackValue: false,
};

const SERVE_COMMAND = "serve";

const SERVICE_NAME = "FeatureService";
const ACCESS = Object.freeze({
  READ: "READ",
  WRITE: "WRITE",
  ADMIN: "ADMIN",
});
const SERVICE_ENDPOINTS = Object.freeze({
  [ACCESS.READ]: [`${SERVICE_NAME}.state`, `${SERVICE_NAME}.redisRead`],
  [ACCESS.WRITE]: [`${SERVICE_NAME}.redisUpdate`],
  [ACCESS.ADMIN]: [`${SERVICE_NAME}.redisSendCommand`],
});

const readDirAsync = promisify(fs.readdir);

// NOTE: for sap/cds < 7.3.0 it was expected to export activate as function property, otherwise export the promise of
//   running activate
const doExportActivateAsProperty =
  cdsPackage.version.localeCompare("7.3.0", undefined, { numeric: true, sensitivity: "base" }) < 0;
// NOTE: for sap/cds < 8.2.3 there was no consistent way to detect cds is running as a server, not for build, compile,
//   etc...
const doLegacyBuildDetection =
  cdsPackage.version.localeCompare("8.2.3", undefined, { numeric: true, sensitivity: "base" }) < 0;

const _overwriteUniqueName = (envFeatureToggles) => {
  const uniqueName = envFeatureToggles?.uniqueName;
  if (!uniqueName) {
    return;
  }
  toggles._reset({ uniqueName });
};

const _getAccessRole = (envFeatureToggles, access) => {
  switch (access) {
    case ACCESS.READ: {
      return envFeatureToggles.readAccessRoles ?? envFeatureToggles.serviceAccessRoles;
    }
    case ACCESS.WRITE: {
      return envFeatureToggles.writeAccessRoles ?? envFeatureToggles.serviceAccessRoles;
    }
    case ACCESS.ADMIN: {
      return envFeatureToggles.adminAccessRoles;
    }
  }
};

const _overwriteAccessRoles = (envFeatureToggles) => {
  if (
    !envFeatureToggles?.serviceAccessRoles &&
    !envFeatureToggles?.readAccessRoles &&
    !envFeatureToggles?.writeAccessRoles &&
    !envFeatureToggles?.adminAccessRoles
  ) {
    return;
  }
  cds.on("loaded", (csn) => {
    if (!csn.definitions[SERVICE_NAME]) {
      return;
    }
    for (const [access, endpoints] of Object.entries(SERVICE_ENDPOINTS)) {
      const accessRole = _getAccessRole(envFeatureToggles, access);
      if (accessRole) {
        for (const endpoint of endpoints) {
          csn.definitions[endpoint]["@requires"] = accessRole;
        }
      }
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

  const defaultFtsScopeCallback = (context) => ({ user: context.user?.id, tenant: context.tenant });
  const ftsScopeCallback = envFeatureToggles?.ftsScopeCallback
    ? require(pathlib.resolve(envFeatureToggles.ftsScopeCallback))
    : defaultFtsScopeCallback;

  const doEnableHeaderFeatures = cds.env.profiles?.includes("development");
  const _getReqFeatures = (req) => {
    if (doEnableHeaderFeatures && req.headers.features) {
      return req.headers.features;
    }
    if (cds.context.user?.features) {
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
  _overwriteAccessRoles(envFeatureToggles);
  _registerClientCloseOnShutdown();

  const isServe = cds.cli?.command === SERVE_COMMAND;
  const isBuild = cds.build?.register;
  if ((doLegacyBuildDetection && isBuild) || (!doLegacyBuildDetection && !isServe)) {
    return;
  }
  await toggles.initializeFeatures({
    config: envFeatureToggles?.config,
    configFile: envFeatureToggles?.configFile,
    configAuto: ftsAutoConfig,
  });

  _registerFeatureProvider(envFeatureToggles);
};

const pluginExport = () => {
  return doExportActivateAsProperty ? { activate } : activate();
};

module.exports = {
  SERVICE_ENDPOINTS,

  activate,
  pluginExport,

  _: {
    _overwriteUniqueName,
    _getAccessRole,
    _overwriteAccessRoles,
    _registerFeatureProvider,
    _registerClientCloseOnShutdown,
    _discoverFtsAutoConfig,
  },
};
