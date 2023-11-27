"use strict";

const { readFileSync } = require("fs");
const { join } = require("path");

describe("docs", () => {
  it("documentation README / overview consistency check", async () => {
    const headings = ["Install or Upgrade", "Features", "Peers"];
    const readmeData = readFileSync(join(__dirname, "..", "README.md")).toString();
    const overviewData = readFileSync(join(__dirname, "..", "docs", "index.md")).toString();
    for (const heading of headings) {
      const extractionRegex = new RegExp(`## ${heading}(.*?)(?:##|$)`, "s");
      const readmeContent = extractionRegex
        .exec(readmeData)[1]
        .replaceAll("https://cap-js-community.github.io/feature-toggle-library/", "");
      const overviewContent = extractionRegex.exec(overviewData)[1];
      expect(readmeContent).toEqual(overviewContent);
    }
  });
});
