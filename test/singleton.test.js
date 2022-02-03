"use strict";

const MockFeatureToggles = jest.fn();

jest.mock("../src/featureToggles", () => {
  const { FeatureToggles } = jest.requireActual("../src/featureToggles");
  Object.getOwnPropertyNames(FeatureToggles.prototype).forEach((key) => {
    MockFeatureToggles.prototype[key] = jest.fn();
  });
  return {
    FeatureToggles: MockFeatureToggles,
  };
});

const { FeatureToggles } = jest.requireActual("../src/featureToggles");
const singleton = require("../src/singleton");
const { ENV } = require("../src/helper");

describe("singleton test", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("singleton correctly exposes public apis of feature-toggles", async () => {
    // check same properties
    const singletonProps = Object.keys(singleton).filter((p) => !p.startsWith("_"));
    const ftProps = Object.getOwnPropertyNames(FeatureToggles.prototype).filter(
      (p) => p !== "constructor" && !p.startsWith("_")
    );

    const sameLength = ftProps.length === singletonProps.length;
    const mismatch = ftProps.find((p, i) => p !== singletonProps[i]);

    expect(sameLength).toBe(true);
    expect(mismatch).toBe(undefined);

    // singleton prop is correctly bound to instance
    const inputs = ["input1", "input2"];
    const instance = singleton._._instance();
    for (const prop of singletonProps) {
      const singletonFunc = singleton[prop];
      const instanceFunc = instance[prop];
      await singletonFunc(...inputs);
      expect(instanceFunc).toBeCalledTimes(1);
      expect(instanceFunc).toHaveBeenCalledWith(...inputs);
    }
  });

  it("singleton uniquename can be set via cf app name", async () => {
    jest.resetModules();
    process.env.VCAP_APPLICATION = JSON.stringify({ application_name: "test_app_name" });

    require("../src/singleton");
    expect(MockFeatureToggles.mock.calls).toMatchInlineSnapshot(`
      Array [
        Array [
          Object {
            "uniqueName": "test_app_name",
          },
        ],
      ]
    `);

    Reflect.deleteProperty(process.env, "VCAP_APPLICATION");
  });

  it("singleton uniquename can be set via env and beats cf app name", async () => {
    jest.resetModules();
    process.env.VCAP_APPLICATION = JSON.stringify({ application_name: "test_app_name" });
    process.env[ENV.UNIQUE_NAME] = "test_unqiue_name";

    require("../src/singleton");
    expect(MockFeatureToggles.mock.calls).toMatchInlineSnapshot(`
      Array [
        Array [
          Object {
            "uniqueName": "test_unqiue_name",
          },
        ],
      ]
    `);

    Reflect.deleteProperty(process.env, "VCAP_APPLICATION");
    Reflect.deleteProperty(process.env, ENV.UNIQUE_NAME);
  });
});
