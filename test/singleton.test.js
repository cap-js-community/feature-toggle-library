"use strict";

jest.mock("../src/featureToggles", () => {
  const { FeatureToggles } = jest.requireActual("../src/featureToggles");
  function MockFeatureToggles() {}
  Object.getOwnPropertyNames(FeatureToggles.prototype).forEach((key) => {
    MockFeatureToggles.prototype[key] = jest.fn();
  });
  return {
    FeatureToggles: MockFeatureToggles,
  };
});

const { FeatureToggles } = jest.requireActual("../src/featureToggles");
const singleton = require("../src/singleton");

describe("singleton test", () => {
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
});
