"use strict";

const MockFeatureToggles = jest.fn();
jest.mock("../src/featureToggles", () => {
  const { FeatureToggles } = jest.requireActual("../src/featureToggles");
  const IGNORE_PROPERTIES = ["constructor", "length", "name", "prototype", "getInstance"];
  Object.getOwnPropertyNames(FeatureToggles.prototype)
    .filter((prop) => !IGNORE_PROPERTIES.includes(prop) && !prop.startsWith("_"))
    .forEach((prop) => {
      MockFeatureToggles.prototype[prop] = jest.fn();
    });
  Object.getOwnPropertyNames(FeatureToggles)
    .filter((prop) => !IGNORE_PROPERTIES.includes(prop) && !prop.startsWith("_"))
    .forEach((prop) => {
      MockFeatureToggles[prop] = jest.fn();
    });
  let instance = new MockFeatureToggles();
  MockFeatureToggles.getInstance = () => instance;
  return {
    FeatureToggles: MockFeatureToggles,
  };
});
const singleton = require("../src/singleton");

const { FeatureToggles } = jest.requireActual("../src/featureToggles");
describe("singleton test with feature toggles class mock", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("singleton property mapping is correct", async () => {
    // NOTE: the singleton properties and FeatureToggles properties match up, but the mapping could be flipped, so we
    //  check that the calls reach the correct function

    const IGNORE_PROPERTIES = ["constructor", "length", "name", "prototype", "getInstance"];
    const ftInstanceProps = Object.getOwnPropertyNames(FeatureToggles.prototype).filter(
      (prop) => !IGNORE_PROPERTIES.includes(prop) && !prop.startsWith("_")
    );
    const ftClassProps = Object.getOwnPropertyNames(FeatureToggles).filter(
      (prop) => !IGNORE_PROPERTIES.includes(prop) && !prop.startsWith("_")
    );
    const ftProps = [].concat(ftClassProps, ftInstanceProps);
    const singletonProps = Object.keys(singleton).filter((p) => !p.startsWith("_"));

    const inputs = ["input1", "input2"];
    const instance = MockFeatureToggles.getInstance();
    for (const prop of singletonProps) {
      const singletonFunc = singleton[prop];
      const instanceFunc = instance[prop] || MockFeatureToggles[prop];
      await singletonFunc(...inputs);
      expect(instanceFunc).toHaveBeenCalledTimes(1);
      expect(instanceFunc).toHaveBeenCalledWith(...inputs);
    }
  });
});
