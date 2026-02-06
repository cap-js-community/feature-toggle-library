"use strict";

const { ENV } = require("../src/feature-toggles");

describe("singleton", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test("singleton unique name can be set via cf app name", async () => {
    process.env.VCAP_APPLICATION = JSON.stringify({ application_name: "test_app_name" });

    const toggles = require("../src/");
    const FeatureToggles = toggles.constructor;
    expect(FeatureToggles._getDefaultUniqueName()).toMatchInlineSnapshot(`"test_app_name"`);

    Reflect.deleteProperty(process.env, "VCAP_APPLICATION");
  });

  test("singleton unique name can be set via cf app name, but ignores blue green suffix -idle", async () => {
    process.env.VCAP_APPLICATION = JSON.stringify({ application_name: "test_app_name-idle" });

    const toggles = require("../src/");
    const FeatureToggles = toggles.constructor;
    expect(FeatureToggles._getDefaultUniqueName()).toMatchInlineSnapshot(`"test_app_name"`);

    Reflect.deleteProperty(process.env, "VCAP_APPLICATION");
  });

  test("singleton unique name can be set via cf app name, but ignores blue green suffix -live", async () => {
    process.env.VCAP_APPLICATION = JSON.stringify({ application_name: "test_app_name-live" });

    const toggles = require("../src/");
    const FeatureToggles = toggles.constructor;
    expect(FeatureToggles._getDefaultUniqueName()).toMatchInlineSnapshot(`"test_app_name"`);

    Reflect.deleteProperty(process.env, "VCAP_APPLICATION");
  });

  test("singleton unique name can be set via env and beats cf app name", async () => {
    process.env.VCAP_APPLICATION = JSON.stringify({ application_name: "test_app_name" });
    process.env[ENV.UNIQUE_NAME] = "test_unique_name";

    const toggles = require("../src/");
    const FeatureToggles = toggles.constructor;
    expect(FeatureToggles._getDefaultUniqueName()).toMatchInlineSnapshot(`"test_unique_name"`);

    Reflect.deleteProperty(process.env, "VCAP_APPLICATION");
    Reflect.deleteProperty(process.env, ENV.UNIQUE_NAME);
  });
});
