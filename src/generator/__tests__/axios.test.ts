import { describe, it, expect } from "vitest";
import { generateClientFile } from "../axios";
import type { AxigenConfig, ParsedEndpoint } from "../../types";

function baseConfig(overrides: Partial<AxigenConfig> = {}): AxigenConfig {
  return {
    input: "./openapi.yaml",
    output: { client: "./src/api/client.ts" },
    axiosInstancePath: "../lib/axios",
    ...overrides,
  };
}

function baseEndpoint(overrides: Partial<ParsedEndpoint> = {}): ParsedEndpoint {
  return {
    operationId: "getUser",
    method: "get",
    path: "/users/{id}",
    tags: [],
    pathParams: [],
    queryParams: [],
    bodyRequired: false,
    ...overrides,
  };
}

describe("generateClientFile", () => {
  it("imports axios types and the configured axios instance export for TS output", () => {
    const output = generateClientFile({ endpoints: [], config: baseConfig() });
    expect(output).toContain("import type { AxiosRequestConfig, AxiosResponse } from 'axios'");
    expect(output).toContain("import { axiosInstance } from '../lib/axios'");
  });

  it("omits the AxiosRequestConfig type import for JS output", () => {
    const output = generateClientFile({ endpoints: [], config: baseConfig({ language: "js" }) });
    expect(output).not.toContain("import type { AxiosRequestConfig");
  });

  it("uses a custom axiosInstanceExport name when configured", () => {
    const output = generateClientFile({ endpoints: [], config: baseConfig({ axiosInstanceExport: "myApi" }) });
    expect(output).toContain("import { myApi } from '../lib/axios'");
  });

  it("imports only the type names actually used by the endpoints, sorted alphabetically", () => {
    const endpoints = [
      baseEndpoint({
        operationId: "getUser",
        pathParams: [{ name: "id", required: true, schema: { type: "string" } }],
        responseSchema: { type: "object" },
      }),
    ];
    const output = generateClientFile({ endpoints, config: baseConfig(), typesRelativePath: "./types" });
    expect(output).toContain("import type { GetUserPathParams, GetUserResponse } from './types'");
  });

  it("generates path params as required function arguments with their PathParams type", () => {
    const endpoints = [baseEndpoint({ pathParams: [{ name: "id", required: true, schema: { type: "string" } }] })];
    const output = generateClientFile({ endpoints, config: baseConfig() });
    expect(output).toContain("id: GetUserPathParams['id']");
  });

  it("interpolates path params into a template literal URL", () => {
    const endpoints = [baseEndpoint({ pathParams: [{ name: "id", required: true, schema: { type: "string" } }] })];
    const output = generateClientFile({ endpoints, config: baseConfig() });
    expect(output).toContain("url: `/users/${id}`");
  });

  it("uses a plain string literal URL when there are no path params", () => {
    const endpoints = [baseEndpoint({ path: "/users", pathParams: [] })];
    const output = generateClientFile({ endpoints, config: baseConfig() });
    expect(output).toContain("url: '/users'");
  });

  it("adds a required `data` param typed with Body when the request body is required", () => {
    const endpoints = [
      baseEndpoint({ operationId: "createUser", method: "post", bodySchema: { type: "object" }, bodyRequired: true }),
    ];
    const output = generateClientFile({ endpoints, config: baseConfig() });
    expect(output).toContain("data: CreateUserBody");
    expect(output).not.toContain("data?: CreateUserBody");
  });

  it("adds an optional `data` param when the request body is not required", () => {
    const endpoints = [
      baseEndpoint({ operationId: "createUser", method: "post", bodySchema: { type: "object" }, bodyRequired: false }),
    ];
    const output = generateClientFile({ endpoints, config: baseConfig() });
    expect(output).toContain("data?: CreateUserBody");
  });

  it("adds an optional `params` argument when all query params are optional", () => {
    const endpoints = [baseEndpoint({ queryParams: [{ name: "expand", required: false, schema: { type: "boolean" } }] })];
    const output = generateClientFile({ endpoints, config: baseConfig() });
    expect(output).toContain("params?: GetUserQueryParams");
  });

  it("adds a required `params` argument when at least one query param is required", () => {
    const endpoints = [baseEndpoint({ queryParams: [{ name: "page", required: true, schema: { type: "number" } }] })];
    const output = generateClientFile({ endpoints, config: baseConfig() });
    expect(output).toContain("params: GetUserQueryParams");
    expect(output).not.toContain("params?: GetUserQueryParams");
  });

  it("merges query params into config.params in the generated call body", () => {
    const endpoints = [baseEndpoint({ queryParams: [{ name: "page", required: true, schema: { type: "number" } }] })];
    const output = generateClientFile({ endpoints, config: baseConfig() });
    expect(output).toContain("const mergedConfig: AxiosRequestConfig = { ...config, params: { ...params, ...config?.params } }");
    expect(output).toContain("...mergedConfig");
  });

  it("calls the axios instance using the two-argument object-form signature", () => {
    const endpoints = [baseEndpoint({ pathParams: [{ name: "id", required: true, schema: { type: "string" } }] })];
    const output = generateClientFile({ endpoints, config: baseConfig() });
    expect(output).toContain("return axiosInstance({ method: 'GET', url: `/users/${id}`, ...config }, options)");
  });

  it("includes `data` in the call body when the endpoint has a request body", () => {
    const endpoints = [baseEndpoint({ operationId: "createUser", method: "post", path: "/users", bodySchema: { type: "object" } })];
    const output = generateClientFile({ endpoints, config: baseConfig() });
    expect(output).toContain("data, ...config");
  });

  it("always appends optional `config` and `options` parameters for TS output", () => {
    const endpoints = [baseEndpoint({ pathParams: [], queryParams: [] })];
    const output = generateClientFile({ endpoints, config: baseConfig() });
    expect(output).toContain("config?: AxiosRequestConfig, options?: AxiosRequestConfig");
  });

  it("wraps the return type in Promise<AxiosResponse<...>> using the response type or unknown", () => {
    const withResponse = generateClientFile({
      endpoints: [baseEndpoint({ responseSchema: { type: "string" } })],
      config: baseConfig(),
    });
    expect(withResponse).toContain(": Promise<AxiosResponse<GetUserResponse>>");

    const withoutResponse = generateClientFile({ endpoints: [baseEndpoint()], config: baseConfig() });
    expect(withoutResponse).toContain(": Promise<AxiosResponse<unknown>>");
  });

  it("includes JSDoc with summary, description, method/path, and tags by default", () => {
    const endpoints = [
      baseEndpoint({ summary: "Get a user", description: "Fetches a single user by id", tags: ["users"] }),
    ];
    const output = generateClientFile({ endpoints, config: baseConfig() });
    expect(output).toContain("* Get a user");
    expect(output).toContain("* Fetches a single user by id");
    expect(output).toContain("* `GET /users/{id}`");
    expect(output).toContain("* @tags users");
  });

  it("omits JSDoc entirely when config.jsdoc is false", () => {
    const endpoints = [baseEndpoint({ summary: "Get a user" })];
    const output = generateClientFile({ endpoints, config: baseConfig({ jsdoc: false }) });
    expect(output).not.toContain("/**");
  });

  it("skips the duplicate description line when it matches the summary", () => {
    const endpoints = [baseEndpoint({ summary: "Get a user", description: "Get a user" })];
    const output = generateClientFile({ endpoints, config: baseConfig() });
    const occurrences = output.match(/\* Get a user/g) ?? [];
    expect(occurrences).toHaveLength(1);
  });

  it("applies the configured function name resolver to the generated function name", () => {
    const endpoints = [baseEndpoint({ operationId: "GetUser", method: "get" })];
    const output = generateClientFile({
      endpoints,
      config: baseConfig({ functionName: { appendMethod: true } }),
    });
    expect(output).toContain("export async function getGetUser(");
  });
});
