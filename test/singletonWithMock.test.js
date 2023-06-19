"use strict";

const MockFeatureToggles = jest.fn();
jest.mock("../src/featureToggles", () => {
  const { ftInstanceProps, ftClassProps } = require("./__common__/ftProps");
  ftInstanceProps.forEach((prop) => {
    MockFeatureToggles.prototype[prop] = jest.fn();
  });
  ftClassProps.forEach((prop) => {
    MockFeatureToggles[prop] = jest.fn();
  });
  let instance = new MockFeatureToggles();
  MockFeatureToggles.getInstance = () => instance;
  return {
    FeatureToggles: MockFeatureToggles,
  };
});
const singleton = require("../src/singleton");

describe("singleton test with feature toggles class mock", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("singleton property mapping is correct", async () => {
    // NOTE: the singleton properties and FeatureToggles properties match up, but the mapping could be flipped, so we
    const { singletonProps } = require("./__common__/ftProps");

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
