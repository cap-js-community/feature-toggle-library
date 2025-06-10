"use strict";

const cds = require("@sap/cds");
const toggles = require("../src");

const FEATURE = require("./srv/feature");

const server = cds.test("test-cap-server");
const systemCall = { validateStatus: () => true, auth: { username: "system", password: "system" } };

describe("test-cap-server check-service", () => {
  beforeEach(async () => {
    await Promise.all(Object.values(FEATURE).map((key) => toggles.resetFeatureValue(key)));
  });
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
    await toggles.changeFeatureValue("/fts/check-service-extension", true);
    expect(toggles.getFeatureValue("/fts/check-service-extension")).toBe(true);
    const response = await server.get("/rest/check/priority", systemCall);
    expect(response.status).toBe(200);
    expect(response.data).toBe(true);
  });
});
