import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { generate } from "../generate";
import { makeTmpDir, writeFile } from "../test-utils/tmp";
import type { AxigenConfig } from "../types";

describe("generate", () => {
  let tmp: ReturnType<typeof makeTmpDir>;

  beforeEach(() => {
    tmp = makeTmpDir();
  });

  afterEach(() => {
    tmp.cleanup();
  });

  const specYaml = `
openapi: "3.0.0"
info:
  title: Sample API
  version: "1.0.0"
paths:
  /users/{id}:
    get:
      operationId: getUser
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/User'
components:
  schemas:
    User:
      type: object
      properties:
        id:
          type: string
        name:
          type: string
`;

  function baseConfig(overrides: Partial<AxigenConfig> = {}): AxigenConfig {
    return {
      input: "./openapi.yaml",
      output: { client: "./out/client.ts", types: "./out/types.ts" },
      axiosInstancePath: "../lib/axios",
      ...overrides,
    };
  }

  it("parses the spec, writes client + types files, and returns their resolved paths", async () => {
    writeFile(tmp.dir, "openapi.yaml", specYaml);

    const result = await generate(baseConfig(), tmp.dir);

    expect(result.endpointCount).toBe(1);
    expect(fs.existsSync(result.clientPath)).toBe(true);
    expect(result.typesPath).toBeDefined();
    expect(fs.existsSync(result.typesPath as string)).toBe(true);

    const clientContent = fs.readFileSync(result.clientPath, "utf-8");
    expect(clientContent).toContain("export async function getUser(");

    const typesContent = fs.readFileSync(result.typesPath as string, "utf-8");
    expect(typesContent).toContain("export type User = {");
  });

  it("creates output directories that do not yet exist", async () => {
    writeFile(tmp.dir, "openapi.yaml", specYaml);

    const config = baseConfig({ output: { client: "./deeply/nested/client.ts", types: "./deeply/nested/types.ts" } });
    const result = await generate(config, tmp.dir);

    expect(fs.existsSync(result.clientPath)).toBe(true);
  });

  it("skips writing a types file when output.types is not configured", async () => {
    writeFile(tmp.dir, "openapi.yaml", specYaml);

    const config = baseConfig({ output: { client: "./out/client.ts" } });
    const result = await generate(config, tmp.dir);

    expect(result.typesPath).toBeUndefined();
  });

  it("skips writing a types file when language is 'js', even if output.types is set", async () => {
    writeFile(tmp.dir, "openapi.yaml", specYaml);

    const config = baseConfig({ language: "js" });
    const result = await generate(config, tmp.dir);

    // typesPath is still resolved (used only for relative import computation),
    // but the file itself must not be written.
    expect(fs.existsSync(result.typesPath as string)).toBe(false);
  });

  it("throws when the spec produces zero endpoints", async () => {
    const emptySpec = `
openapi: "3.0.0"
info:
  title: Empty
  version: "1.0.0"
paths: {}
`;
    writeFile(tmp.dir, "openapi.yaml", emptySpec);

    await expect(generate(baseConfig(), tmp.dir)).rejects.toThrow(/No endpoints found/i);
  });

  it("applies the tags filter when resolving endpoints", async () => {
    const taggedSpec = `
openapi: "3.0.0"
info:
  title: Tagged API
  version: "1.0.0"
paths:
  /public:
    get:
      operationId: getPublic
      tags: [public]
      responses:
        "200": { description: ok }
  /internal:
    get:
      operationId: getInternal
      tags: [internal]
      responses:
        "200": { description: ok }
`;
    writeFile(tmp.dir, "openapi.yaml", taggedSpec);

    const result = await generate(baseConfig({ tags: ["public"] }), tmp.dir);
    expect(result.endpointCount).toBe(1);

    const clientContent = fs.readFileSync(result.clientPath, "utf-8");
    expect(clientContent).toContain("getPublic");
    expect(clientContent).not.toContain("getInternal");
  });

  it("computes a relative import path from the client file to the types file", async () => {
    writeFile(tmp.dir, "openapi.yaml", specYaml);

    const config = baseConfig({ output: { client: "./out/client.ts", types: "./out/shared/types.ts" } });
    const result = await generate(config, tmp.dir);

    const clientContent = fs.readFileSync(result.clientPath, "utf-8");
    expect(clientContent).toContain("from './shared/types'");
  });
});
