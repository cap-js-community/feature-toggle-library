"use strict";

const { FeatureToggles } = require("../src/featureToggles");
const singleton = require("../src/singleton");
const { ENV } = require("../src/shared/static");

let ftInstanceProps;
let ftClassProps;
let ftProps;

describe("singleton test", () => {
  beforeAll(() => {
    const IGNORE_PROPERTIES = ["constructor", "length", "name", "prototype", "getInstance"];
    ftInstanceProps = Object.getOwnPropertyNames(FeatureToggles.prototype).filter(
      (prop) => !IGNORE_PROPERTIES.includes(prop) && !prop.startsWith("_")
    );
    ftClassProps = Object.getOwnPropertyNames(FeatureToggles).filter(
      (prop) => !IGNORE_PROPERTIES.includes(prop) && !prop.startsWith("_")
    );
    ftProps = [].concat(ftClassProps, ftInstanceProps);
  });
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("singleton correctly exposes public apis of feature-toggles", async () => {
    // check same properties
    const singletonProps = Object.keys(singleton).filter((p) => !p.startsWith("_"));

    const sameLength = ftProps.length === singletonProps.length;
    const mismatch = ftProps.find((p, i) => p !== singletonProps[i]);

    expect(sameLength).toBe(true);
    expect(mismatch).toBe(undefined);
  });

  it("singleton property mapping is correct", async () => {
    // NOTE: the singleton properties and FeatureToggles properties match up, but the mapping could be flipped, so we
    //  check that the calls reach the correct function

    const spies = {};
    const instance = FeatureToggles.__instance;
    for (const prop of ftInstanceProps) {
      spies[prop] = jest.spyOn(instance, prop).mockReturnValueOnce();
    }
    for (const prop of ftClassProps) {
      spies[prop] = jest.spyOn(FeatureToggles, prop).mockReturnValueOnce();
    }

    jest.resetModules();
    require("../src/singleton");

    const inputs = ["input1", "input2"];
    for (const prop of ftProps) {
      const propSpy = spies[prop];
      const singletonFunc = singleton[prop];
      await singletonFunc(...inputs);
      expect(propSpy).toHaveBeenCalledTimes(1);
      expect(propSpy).toHaveBeenCalledWith(...inputs);
      propSpy.resetMocks();
    }
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
