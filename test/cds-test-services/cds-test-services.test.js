"use strict";

const cds = require("@sap/cds");
const toggles = require("../../src");
const { pluginExport } = require("../../src/plugin");

const { FEATURE, mockConfig: config } = require("../__common__/mockdata");

const server = cds.test("test/cds-test-services");
const systemCall = { validateStatus: () => true, auth: { username: "system", password: "system" } };

describe("cds-test", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("feature-service", () => {
    beforeEach(async () => {
      toggles._reset();
      await toggles.initializeFeatures({ config });
    });

    const featureBChanges = [
      {
        key: FEATURE.B,
        value: 2,
      },
      {
        key: FEATURE.B,
        value: 20,
        scope: {
          tenant: "a",
        },
      },
      {
        key: FEATURE.B,
        value: 30,
        scope: {
          tenant: "b",
        },
      },
    ];

    test.each(["/rest/feature/redisSendCommand"])("%s is forbidden for system", async (endpoint) => {
      const response = await server.post(endpoint, {}, systemCall);
      expect(response.status).toBe(403);
    });

    test("state response no change", async () => {
      const response = await server.get("/rest/feature/state", systemCall);
      expect(response.status).toBe(200);
      expect(response.data).toMatchSnapshot();
    });

    test("state response with changes", async () => {
      await server.post("/rest/feature/redisUpdate", featureBChanges, systemCall);
      const response = await server.get("/rest/feature/state", systemCall);
      expect(response.status).toBe(200);
      expect(response.data).toMatchSnapshot();
    });

    test("redisRead response no change", async () => {
      const response = await server.post("/rest/feature/redisRead", {}, systemCall);
      expect(response.status).toBe(200);
      expect(response.data).toMatchInlineSnapshot(`{}`);
    });

    test("redisRead response with changes", async () => {
      await server.post("/rest/feature/redisUpdate", featureBChanges, systemCall);
      const response = await server.post("/rest/feature/redisRead", {}, systemCall);
      expect(response.status).toBe(200);
      expect(response.data).toMatchInlineSnapshot(`
        {
          "test/feature_b": {
            "config": {
              "SOURCE": "RUNTIME",
              "TYPE": "number",
            },
            "fallbackValue": 1,
            "rootValue": 2,
            "scopedValues": {
              "tenant::a": 20,
              "tenant::b": 30,
            },
          },
        }
      `);
    });

    test("redisUpdate response success", async () => {
      const response = await server.post(
        "/rest/feature/redisUpdate",
        {
          key: FEATURE.A,
          value: true,
        },
        systemCall
      );
      expect(response.status).toBe(204);
      expect(response.data).toMatchInlineSnapshot(`""`);
    });

    test("redisUpdate response validation fail", async () => {
      const response = await server.post(
        "/rest/feature/redisUpdate",
        {
          key: FEATURE.A,
          value: 100,
        },
        systemCall
      );
      expect(response.status).toBe(422);
      expect(response.data).toMatchInlineSnapshot(`
        {
          "error": {
            "code": "422",
            "message": "value "100" has invalid type number, must be boolean",
            "target": "test/feature_a",
          },
        }
      `);
    });
  });

  describe("check-service", () => {
    beforeAll(async () => {
      toggles._reset();
      jest.spyOn(process, "cwd").mockReturnValue(__dirname);
      await pluginExport();
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
      // TODO this does not use cds.middlewares, so it will not work...
      const response = await server.get("/rest/check/priority", systemCall);
      expect(response.status).toBe(200);
      expect(response.data).toBe(true);
    });
  });
});
