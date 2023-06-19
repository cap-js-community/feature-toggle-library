"use strict";

const { ENV } = require("../src/shared/static");

describe("singleton test", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("singleton exposes same public apis as feature-toggles", async () => {
    const { ftProps, singletonProps } = require("./__common__/ftProps");

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
