"use strict";

const { LazyCache } = require("../src/lazyCaches");

describe("lazyCaches", () => {
  describe("LazyCache", () => {
    it("custom separator", async () => {
      const customSeparator = "--";
      const lazyCache = new LazyCache({ separator: customSeparator });
      lazyCache.set(["a", "b", "c"], "abc");
      expect(Object.keys(lazyCache._data()).includes(["a", "b", "c"].join(customSeparator))).toBe(true);
    });

    it("has/get/set/setCb/setCbAsync", async () => {
      const lazyCache = new LazyCache();
      lazyCache.set("", "empty");
      lazyCache.set("a", "a");
      lazyCache.set("b", "b");
      lazyCache.set("c", "c");
      lazyCache.set(["a", "b"], "ab");
      lazyCache.set(["a", "b", "c"], "abc");
      lazyCache.setCb("a with cb", () => "a with cb");
      lazyCache.setCb("b with cb", (b) => b, "b with cb");
      lazyCache.setCb("c with cb", (b, c) => b + c, "c", " with cb");
      await lazyCache.setCbAsync("a with cbA", async () => "a with cbA");
      await lazyCache.setCbAsync("b with cbA", async (b) => b, "b with cbA");
      await lazyCache.setCbAsync("c with cbA", async (b, c) => b + c, "c", " with cbA");

      expect(lazyCache.set("d", "d")).toBe(lazyCache);

      expect(lazyCache.has("a")).toBe(true);
      expect(lazyCache.has(["a"])).toBe(true);
      expect(lazyCache.has("z")).toBe(false);
      expect(lazyCache.has(["z"])).toBe(false);

      expect(lazyCache.get("")).toBe("empty");
      expect(lazyCache.get([])).toBe("empty");
      expect(lazyCache.get("a")).toBe("a");
      expect(lazyCache.get("b")).toBe("b");
      expect(lazyCache.get("c")).toBe("c");
      expect(lazyCache.get(["a", "b"])).toBe("ab");
      expect(lazyCache.get(["a", "b", "c"])).toBe("abc");

      expect(lazyCache.get("a with cb")).toBe("a with cb");
      expect(lazyCache.get("b with cb")).toBe("b with cb");
      expect(lazyCache.get("c with cb")).toBe("c with cb");
      expect(lazyCache.get("a with cbA")).toBe("a with cbA");
      expect(lazyCache.get("b with cbA")).toBe("b with cbA");
      expect(lazyCache.get("c with cbA")).toBe("c with cbA");

      expect(lazyCache._data()).toMatchInlineSnapshot(`
        {
          "": "empty",
          "a": "a",
          "a with cb": "a with cb",
          "a with cbA": "a with cbA",
          "a##b": "ab",
          "a##b##c": "abc",
          "b": "b",
          "b with cb": "b with cb",
          "b with cbA": "b with cbA",
          "c": "c",
          "c with cb": "c with cb",
          "c with cbA": "c with cbA",
          "d": "d",
        }
      `);
    });

    it("getSetCb/getSetCbAsync", async () => {
      const lazyCache = new LazyCache();
      const cbSpy = jest.fn((a) => a);
      const cbAsyncSpy = jest.fn(async (a) => a);

      for (let i = 0; i < 10; i++) {
        expect(lazyCache.getSetCb("a", cbSpy, "a result")).toBe("a result");
        expect(await lazyCache.getSetCbAsync("b", cbAsyncSpy, "b result")).toBe("b result");
      }
      expect(cbSpy).toHaveBeenCalledTimes(1);
      expect(cbAsyncSpy).toHaveBeenCalledTimes(1);

      expect(lazyCache._data()).toMatchInlineSnapshot(`
        {
          "a": "a result",
          "b": "b result",
        }
      `);
    });

    it("count/delete/clear", async () => {
      const lazyCache = new LazyCache();
      const n = 10;
      const values = Array.from(Array(n).keys()).map((i) => String.fromCharCode(i + "a".charCodeAt(0)));
      values.forEach((value) => lazyCache.set(value, value));

      expect(lazyCache.count()).toBe(n);
      lazyCache.delete("a");
      expect(lazyCache.count()).toBe(n - 1);
      lazyCache.delete("a");
      expect(lazyCache.count()).toBe(n - 1);
      lazyCache.delete("b");
      expect(lazyCache.count()).toBe(n - 2);
      lazyCache.delete("b");
      expect(lazyCache.count()).toBe(n - 2);

      lazyCache.clear();
      expect(lazyCache.count()).toBe(0);
    });
  });
});
