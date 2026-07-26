import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../loader";
import { makeTmpDir, writeFile } from "../../test-utils/tmp";

describe("loadConfig", () => {
  let tmp: ReturnType<typeof makeTmpDir>;

  beforeEach(() => {
    tmp = makeTmpDir();
  });

  afterEach(() => {
    tmp.cleanup();
  });

  it("loads a valid axigen.config.js from the default search locations", async () => {
    writeFile(
      tmp.dir,
      "axigen.config.js",
      `module.exports = {
        input: './openapi.yaml',
        output: { client: './client.ts' },
        axiosInstancePath: '../lib/axios',
      };`,
    );

    const config = await loadConfig(tmp.dir);
    expect(config.input).toBe("./openapi.yaml");
    expect(config.output.client).toBe("./client.ts");
    expect(config.axiosInstancePath).toBe("../lib/axios");
  });

  it("applies default values for optional fields", async () => {
    writeFile(
      tmp.dir,
      "axigen.config.js",
      `module.exports = {
        input: './openapi.yaml',
        output: { client: './client.ts' },
        axiosInstancePath: '../lib/axios',
      };`,
    );

    const config = await loadConfig(tmp.dir);
    expect(config.axiosInstanceExport).toBe("axiosInstance");
    expect(config.language).toBe("ts");
    expect(config.jsdoc).toBe(true);
    expect(config.tags).toBeUndefined();
  });

  it("loads config from an explicit configPath, bypassing the default search", async () => {
    writeFile(
      tmp.dir,
      "custom.config.js",
      `module.exports = {
        input: './a.yaml',
        output: { client: './c.ts' },
        axiosInstancePath: '../axios',
      };`,
    );

    const config = await loadConfig(tmp.dir, "custom.config.js");
    expect(config.input).toBe("./a.yaml");
  });

  it("throws when an explicit configPath does not exist", async () => {
    await expect(loadConfig(tmp.dir, "missing.config.js")).rejects.toThrow(/Config file not found/i);
  });

  it("throws when no config file is found in any default location", async () => {
    await expect(loadConfig(tmp.dir)).rejects.toThrow(/No config file found/i);
  });

  it("throws when the config's default export is not an object", async () => {
    writeFile(tmp.dir, "axigen.config.js", `module.exports = "not-an-object";`);
    await expect(loadConfig(tmp.dir)).rejects.toThrow(/must export an object/i);
  });

  it("throws when 'input' is missing", async () => {
    writeFile(
      tmp.dir,
      "axigen.config.js",
      `module.exports = { output: { client: './c.ts' }, axiosInstancePath: '../axios' };`,
    );
    await expect(loadConfig(tmp.dir)).rejects.toThrow(/"input" must be a string/i);
  });

  it("throws when 'output.client' is missing", async () => {
    writeFile(
      tmp.dir,
      "axigen.config.js",
      `module.exports = { input: './a.yaml', output: {}, axiosInstancePath: '../axios' };`,
    );
    await expect(loadConfig(tmp.dir)).rejects.toThrow(/"output.client" is required/i);
  });

  it("throws when 'axiosInstancePath' is missing", async () => {
    writeFile(
      tmp.dir,
      "axigen.config.js",
      `module.exports = { input: './a.yaml', output: { client: './c.ts' } };`,
    );
    await expect(loadConfig(tmp.dir)).rejects.toThrow(/"axiosInstancePath" is required/i);
  });

  it("validates functionName.transforms entries and rejects invalid regex", async () => {
    writeFile(
      tmp.dir,
      "axigen.config.js",
      `module.exports = {
        input: './a.yaml',
        output: { client: './c.ts' },
        axiosInstancePath: '../axios',
        functionName: { transforms: [{ match: '(', replacement: 'x' }] },
      };`,
    );
    await expect(loadConfig(tmp.dir)).rejects.toThrow(/not a valid regex/i);
  });

  it("accepts a valid functionName config with transforms and appendMethod", async () => {
    writeFile(
      tmp.dir,
      "axigen.config.js",
      `module.exports = {
        input: './a.yaml',
        output: { client: './c.ts' },
        axiosInstancePath: '../axios',
        functionName: {
          transforms: [{ match: '-([a-z])', replacement: 'upper:$1' }],
          appendMethod: ['post'],
        },
      };`,
    );

    const config = await loadConfig(tmp.dir);
    expect(config.functionName?.transforms).toHaveLength(1);
    expect(config.functionName?.appendMethod).toEqual(["post"]);
  });

  it("throws when functionName.appendMethod is not a boolean or array", async () => {
    writeFile(
      tmp.dir,
      "axigen.config.js",
      `module.exports = {
        input: './a.yaml',
        output: { client: './c.ts' },
        axiosInstancePath: '../axios',
        functionName: { appendMethod: 'yes' },
      };`,
    );
    await expect(loadConfig(tmp.dir)).rejects.toThrow(/must be a boolean or an array/i);
  });
});
