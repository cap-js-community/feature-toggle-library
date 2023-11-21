// https://cap.cloud.sap/docs/node.js/cds-plugins
"use strict";

const cds = require("@sap/cds");
const cdsPackage = require("@sap/cds/package.json");
const { initializeFeatures } = require("./src/singleton");

const _overwriteServiceAccessRoles = (envFeatureToggles) => {
  if (Array.isArray(envFeatureToggles.serviceAccessRoles)) {
    cds.on("loaded", (csn) => {
      if (csn.definitions.FeatureService) {
        csn.definitions.FeatureService["@requires"] = envFeatureToggles.serviceAccessRoles;
      }
    });
  }
};

const _registerFeatureProvider = () => {
  if (cds.env.requires.toggles) {
    // TODO move to cds.middlewares after ctx_auth before ctx_model
    cds.on("bootstrap", (app) =>
      app.use((req, res, next) => {
        const blauser = cds.context.user.id;
        const blatenant = cds.context.tenant;
        req.features = req.headers.features || "isbn";
        next();
      })
    );
  }
};

const activate = async () => {
  const envFeatureToggles = cds.env.featureToggles;
  if (envFeatureToggles?.config || envFeatureToggles?.configFile) {
    _overwriteServiceAccessRoles(envFeatureToggles);
    _registerFeatureProvider();

    // TODO for the "cds build" use case, this initialize makes no sense
    await initializeFeatures({
      config: envFeatureToggles.config,
      configFile: envFeatureToggles.configFile,
    });

    _registerFeatureProvider();
  }
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
