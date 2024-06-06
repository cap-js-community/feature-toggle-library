"use strict";

const { ENV } = require("../src/shared/static");

describe("singleton", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test("singleton unique name can be set via cf app name", async () => {
    process.env.VCAP_APPLICATION = JSON.stringify({ application_name: "test_app_name" });

    const { FeatureToggles } = require("../src/");
    expect(FeatureToggles._getInstanceUniqueName()).toMatchInlineSnapshot(`"test_app_name"`);

    Reflect.deleteProperty(process.env, "VCAP_APPLICATION");
  });

  test("singleton unique name can be set via env and beats cf app name", async () => {
    process.env.VCAP_APPLICATION = JSON.stringify({ application_name: "test_app_name" });
    process.env[ENV.UNIQUE_NAME] = "test_unique_name";

    const { FeatureToggles } = require("../src/");
    expect(FeatureToggles._getInstanceUniqueName()).toMatchInlineSnapshot(`"test_unique_name"`);

    Reflect.deleteProperty(process.env, "VCAP_APPLICATION");
    Reflect.deleteProperty(process.env, ENV.UNIQUE_NAME);
  });
});
