"use strict";

const cds = require("@sap/cds");
const toggles = require("../../src");

jest.spyOn(process, "cwd").mockReturnValue(__dirname);
// TODO how do we get our plugin and @sap/cds-mtxs loaded as part of the plugin startup here
const server = cds.test("test/cds-test-services");
const systemCall = { validateStatus: () => true, auth: { username: "system", password: "system" } };

describe("cds-test-check-service", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test("priority endpoint with no feature is false", async () => {
    const i = toggles.getFeaturesInfos();
    expect(toggles.getFeatureValue("/fts/check-service-extension")).toBe(false);
    const response = await server.get("/rest/check/priority", systemCall);
    expect(response.status).toBe(200);
    expect(response.data).toBe(false);
  });

  test("priority endpoint with feature is true", async () => {
    await toggles.changeFeatureValue("/fts/check-service-extension", true);
    expect(toggles.getFeatureValue("/fts/check-service-extension")).toBe(true);
    const response = await server.get("/rest/check/priority", systemCall);
    expect(response.status).toBe(200);
    expect(response.data).toBe(true);
  });
});
