"use strict";

const cds = require("@sap/cds");
const toggles = require("../src");

// TODO how do we get our plugin and @sap/cds-mtxs loaded as part of the plugin startup here
// NOTE: the cds.test server naturally loads the plugins of the passed in directory test-cap-server, which
//   in turn defaults to the plugins of the project root, i.e., our cap dev dependencies. Unfortunately, this does
//   not include our own plugin. So, we patch it in here...
const server = cds.test("test-cap-server");
const systemCall = { validateStatus: () => true, auth: { username: "system", password: "system" } };

describe("test-cap-server check-service", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test("priority endpoint with no feature is false", async () => {
    expect(toggles.getFeatureValue("/fts/check-service-extension")).toBe(false);
    const response = await server.get("/rest/check/priority", systemCall);
    expect(response.status).toBe(200);
    expect(response.data).toBe(false);
  });

  test("priority endpoint with feature is true", async () => {
    const bla = cds.env;
    await toggles.changeFeatureValue("/fts/check-service-extension", true);
    expect(toggles.getFeatureValue("/fts/check-service-extension")).toBe(true);
    const response = await server.get("/rest/check/priority", systemCall);
    expect(response.status).toBe(200);
    expect(response.data).toBe(true);
  });
});
