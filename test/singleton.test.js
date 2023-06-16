"use strict";

const { FeatureToggles } = require("../src/featureToggles");
const singleton = require("../src/singleton");
const { ENV } = require("../src/shared/static");

describe("singleton test", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("singleton correctly exposes public apis of feature-toggles", async () => {
    const IGNORE_PROPERTIES = ["constructor", "length", "name", "prototype", "getInstance"];

    // check same properties
    const singletonProps = Object.keys(singleton).filter((p) => !p.startsWith("_"));
    const ftInstanceProps = Object.getOwnPropertyNames(FeatureToggles.prototype).filter(
      (prop) => prop !== "constructor" && !prop.startsWith("_")
    );
    const ftClassProps = Object.getOwnPropertyNames(FeatureToggles).filter(
      (prop) => !IGNORE_PROPERTIES.includes(prop) && !prop.startsWith("_")
    );
    const ftProps = [].concat(ftClassProps, ftInstanceProps);

    const sameLength = ftProps.length === singletonProps.length;
    const mismatch = ftProps.find((p, i) => p !== singletonProps[i]);

    expect(sameLength).toBe(true);
    expect(mismatch).toBe(undefined);
  });

  it("singleton unique name can be set via cf app name", async () => {
    jest.resetModules();
    process.env.VCAP_APPLICATION = JSON.stringify({ application_name: "test_app_name" });

    const { FeatureToggles: FeatureTogglesAgain } = require("../src/featureToggles");
    expect(FeatureTogglesAgain._getInstanceUniqueName()).toMatchInlineSnapshot(`"test_app_name"`);

    Reflect.deleteProperty(process.env, "VCAP_APPLICATION");
  });

  it("singleton unique name can be set via env and beats cf app name", async () => {
    jest.resetModules();
    process.env.VCAP_APPLICATION = JSON.stringify({ application_name: "test_app_name" });
    process.env[ENV.UNIQUE_NAME] = "test_unique_name";

    require("../src/featureToggles");
    const { FeatureToggles: FeatureTogglesAgain } = require("../src/featureToggles");
    expect(FeatureTogglesAgain._getInstanceUniqueName()).toMatchInlineSnapshot(`"test_unique_name"`);

    Reflect.deleteProperty(process.env, "VCAP_APPLICATION");
    Reflect.deleteProperty(process.env, ENV.UNIQUE_NAME);
  });
});
