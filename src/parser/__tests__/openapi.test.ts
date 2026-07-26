import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { parseOpenAPIFile, extractEndpoints } from "../openapi";
import { makeTmpDir, writeFile } from "../../test-utils/tmp";
import type { OpenAPISpec } from "../../types";

describe("parseOpenAPIFile", () => {
  let tmp: ReturnType<typeof makeTmpDir>;

  beforeEach(() => {
    tmp = makeTmpDir();
  });

  afterEach(() => {
    tmp.cleanup();
  });

  it("throws when the file does not exist", () => {
    expect(() => parseOpenAPIFile("/path/does/not/exist.yaml")).toThrow(/not found/i);
  });

  it("parses a valid JSON OpenAPI 3.x spec", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0.0" },
      paths: {
        "/users": {
          get: { responses: { "200": { description: "ok" } } },
        },
      },
    };
    const file = writeFile(tmp.dir, "spec.json", JSON.stringify(spec));

    const result = parseOpenAPIFile(file);
    expect(result.info.title).toBe("Test");
    expect(result.paths["/users"]).toBeDefined();
  });

  it("parses a valid YAML OpenAPI 3.x spec", () => {
    const yamlContent = `
openapi: "3.0.0"
info:
  title: Test YAML
  version: "1.0.0"
paths:
  /ping:
    get:
      responses:
        "200":
          description: ok
`;
    const file = writeFile(tmp.dir, "spec.yaml", yamlContent);

    const result = parseOpenAPIFile(file);
    expect(result.info.title).toBe("Test YAML");
    expect(result.paths["/ping"]).toBeDefined();
  });

  it("parses a valid Swagger 2.x spec", () => {
    const spec = {
      swagger: "2.0",
      info: { title: "Legacy", version: "1.0.0" },
      paths: {
        "/legacy": { get: { responses: { "200": { description: "ok" } } } },
      },
    };
    const file = writeFile(tmp.dir, "spec.json", JSON.stringify(spec));

    const result = parseOpenAPIFile(file);
    expect(result.info.title).toBe("Legacy");
  });

  it("rejects a spec that is neither OpenAPI 3.x nor Swagger 2.x", () => {
    const spec = { info: { title: "Bad", version: "1.0.0" }, paths: {} };
    const file = writeFile(tmp.dir, "spec.json", JSON.stringify(spec));

    expect(() => parseOpenAPIFile(file)).toThrow(/Unsupported spec format/i);
  });

  it("rejects a spec with no paths", () => {
    const spec = { openapi: "3.0.0", info: { title: "NoPaths", version: "1.0.0" } };
    const file = writeFile(tmp.dir, "spec.json", JSON.stringify(spec));

    expect(() => parseOpenAPIFile(file)).toThrow(/no "paths" defined/i);
  });

  it("rejects a file whose parsed content is not an object", () => {
    const file = writeFile(tmp.dir, "spec.json", JSON.stringify("just a string"));
    expect(() => parseOpenAPIFile(file)).toThrow(/Invalid OpenAPI file/i);
  });
});

describe("extractEndpoints", () => {
  function baseSpec(overrides: Partial<OpenAPISpec> = {}): OpenAPISpec {
    return {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0.0" },
      paths: {},
      ...overrides,
    };
  }

  it("extracts a simple GET endpoint with an explicit operationId", () => {
    const spec = baseSpec({
      paths: {
        "/users": {
          get: {
            operationId: "listUsers",
            responses: { "200": { description: "ok" } },
          },
        },
      },
    });

    const endpoints = extractEndpoints(spec);
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0].operationId).toBe("listUsers");
    expect(endpoints[0].method).toBe("get");
    expect(endpoints[0].path).toBe("/users");
  });

  it("generates an operationId from the URL path when none is provided", () => {
    // Note: buildOperationId only derives the id from the URL path segments;
    // the HTTP method is not folded into the generated name.
    const spec = baseSpec({
      paths: {
        "/users/{userId}/posts/{postId}": {
          get: { responses: { "200": { description: "ok" } } },
        },
      },
    });

    const endpoints = extractEndpoints(spec);
    expect(endpoints[0].operationId).toBe("UsersByUserIdPostsByPostId");
  });

  it("splits generated operationId segments on '-' and '_'", () => {
    const spec = baseSpec({
      paths: {
        "/product-variant/{variant_id}": {
          get: { responses: { "200": { description: "ok" } } },
        },
      },
    });

    const endpoints = extractEndpoints(spec);
    expect(endpoints[0].operationId).toBe("ProductVariantByVariantId");
  });

  it("extracts multiple HTTP methods on the same path as separate endpoints", () => {
    const spec = baseSpec({
      paths: {
        "/items": {
          get: { operationId: "listItems", responses: { "200": { description: "ok" } } },
          post: { operationId: "createItem", responses: { "201": { description: "created" } } },
        },
      },
    });

    const endpoints = extractEndpoints(spec);
    expect(endpoints.map((e) => e.method).sort()).toEqual(["get", "post"]);
  });

  it("filters endpoints by tag when filterTags is provided", () => {
    const spec = baseSpec({
      paths: {
        "/a": { get: { operationId: "a", tags: ["public"], responses: { "200": { description: "ok" } } } },
        "/b": { get: { operationId: "b", tags: ["internal"], responses: { "200": { description: "ok" } } } },
      },
    });

    const endpoints = extractEndpoints(spec, ["public"]);
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0].operationId).toBe("a");
  });

  it("does not filter anything when filterTags is empty or undefined", () => {
    const spec = baseSpec({
      paths: {
        "/a": { get: { operationId: "a", tags: ["public"], responses: { "200": { description: "ok" } } } },
      },
    });

    expect(extractEndpoints(spec)).toHaveLength(1);
    expect(extractEndpoints(spec, [])).toHaveLength(1);
  });

  it("separates path-level and operation-level parameters into path/query buckets", () => {
    const spec = baseSpec({
      paths: {
        "/users/{id}": {
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          get: {
            operationId: "getUser",
            parameters: [{ name: "expand", in: "query", required: false, schema: { type: "boolean" } }],
            responses: { "200": { description: "ok" } },
          },
        },
      },
    });

    const [endpoint] = extractEndpoints(spec);
    expect(endpoint.pathParams).toHaveLength(1);
    expect(endpoint.pathParams[0].name).toBe("id");
    expect(endpoint.queryParams).toHaveLength(1);
    expect(endpoint.queryParams[0].name).toBe("expand");
  });

  it("extracts the JSON request body schema and required flag", () => {
    const spec = baseSpec({
      paths: {
        "/users": {
          post: {
            operationId: "createUser",
            requestBody: {
              required: true,
              content: { "application/json": { schema: { type: "object", properties: { name: { type: "string" } } } } },
            },
            responses: { "201": { description: "created" } },
          },
        },
      },
    });

    const [endpoint] = extractEndpoints(spec);
    expect(endpoint.bodyRequired).toBe(true);
    expect(endpoint.bodySchema).toEqual({ type: "object", properties: { name: { type: "string" } } });
  });

  it("defaults bodyRequired to false when requestBody.required is omitted", () => {
    const spec = baseSpec({
      paths: {
        "/users": {
          post: {
            operationId: "createUser",
            requestBody: { content: { "application/json": { schema: { type: "object" } } } },
            responses: { "201": { description: "created" } },
          },
        },
      },
    });

    const [endpoint] = extractEndpoints(spec);
    expect(endpoint.bodyRequired).toBe(false);
  });

  it("picks the first 2xx response's JSON schema as the responseSchema", () => {
    const spec = baseSpec({
      paths: {
        "/users": {
          get: {
            operationId: "listUsers",
            responses: {
              "400": { description: "bad request" },
              "200": { description: "ok", content: { "application/json": { schema: { type: "array", items: { type: "string" } } } } },
            },
          },
        },
      },
    });

    const [endpoint] = extractEndpoints(spec);
    expect(endpoint.responseSchema).toEqual({ type: "array", items: { type: "string" } });
  });

  it("leaves responseSchema undefined when there is no 2xx JSON response", () => {
    const spec = baseSpec({
      paths: {
        "/users": {
          delete: {
            operationId: "deleteUser",
            responses: { "204": { description: "no content" } },
          },
        },
      },
    });

    const [endpoint] = extractEndpoints(spec);
    expect(endpoint.responseSchema).toBeUndefined();
  });

  it("returns an empty array when the spec has no paths defined", () => {
    const spec = baseSpec({ paths: {} });
    expect(extractEndpoints(spec)).toEqual([]);
  });
});
