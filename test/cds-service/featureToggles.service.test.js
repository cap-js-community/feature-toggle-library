"use strict";

const cds = require("@sap/cds");
const toggles = require("../../src");

const { FEATURE, mockConfig: config } = require("../__common__/mockdata");

const server = cds.test("test/cds-test-project");

describe("cds-service", () => {
  beforeAll(async () => {
    await toggles.initializeFeatures({ config });
  });
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("endpoints", () => {
    test.each(["/rest/feature/state"])("%s GET is unauthorized", async (endpoint) => {
      const response = await server.get(endpoint, { validateStatus: () => true });
      expect(response.status).toBe(401);
    });

    test.each(["/rest/feature/redisRead", "/rest/feature/redisUpdate", "/rest/feature/redisSendCommand"])(
      "%s POST is unauthorized",
      async (endpoint) => {
        const response = await server.post(endpoint, {}, { validateStatus: () => true });
        expect(response.status).toBe(401);
      }
    );

    test.each(["/rest/feature/redisSendCommand"])("%s is forbidden for system", async (endpoint) => {
      const response = await server.post(
        endpoint,
        {},
        {
          validateStatus: () => true,
          auth: { username: "system", password: "system" },
        }
      );
      expect(response.status).toBe(403);
    });

    test("state response", async () => {
      const response = await server.get("/rest/feature/state", {
        auth: { username: "system", password: "system" },
      });
      expect(response.status).toBe(200);
      expect(response.data).toMatchSnapshot();
    });

    test("redisRead response", async () => {
      const response = await server.post(
        "/rest/feature/redisRead",
        {},
        { auth: { username: "system", password: "system" } }
      );
      expect(response.status).toBe(200);
      expect(response.data).toMatchInlineSnapshot(`{}`);
    });

    test("redisUpdate response success", async () => {
      const response = await server.post(
        "/rest/feature/redisUpdate",
        {
          key: FEATURE.A,
          value: true,
        },
        {
          auth: { username: "system", password: "system" },
        }
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
        {
          validateStatus: () => true,
          auth: { username: "system", password: "system" },
        }
      );
      expect(response.status).toBe(422);
      expect(response.data).toMatchInlineSnapshot(`
        {
          "error": {
            "@Common.numericSeverity": 4,
            "code": "422",
            "message": "value "100" has invalid type number, must be boolean",
            "target": "test/feature_a",
          },
        }
      `);
    });
  });
});
