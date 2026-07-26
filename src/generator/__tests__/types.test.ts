import { describe, it, expect } from "vitest";
import { schemaToTSType, generateTypesFile, operationToTypeName } from "../types";
import type { SchemaObject, ParsedEndpoint } from "../../types";

describe("schemaToTSType", () => {
  it('returns "unknown" for an undefined schema', () => {
    expect(schemaToTSType(undefined)).toBe("unknown");
  });

  it("maps primitive types", () => {
    expect(schemaToTSType({ type: "string" })).toBe("string");
    expect(schemaToTSType({ type: "number" })).toBe("number");
    expect(schemaToTSType({ type: "integer" })).toBe("number");
    expect(schemaToTSType({ type: "boolean" })).toBe("boolean");
    expect(schemaToTSType({ type: "null" })).toBe("null");
  });

  it("appends '| null' for nullable schemas", () => {
    expect(schemaToTSType({ type: "string", nullable: true })).toBe("string | null");
  });

  it("maps array types recursively", () => {
    expect(schemaToTSType({ type: "array", items: { type: "string" } })).toBe("Array<string>");
    expect(schemaToTSType({ type: "array", items: { type: "array", items: { type: "number" } } })).toBe("Array<Array<number>>");
  });

  it("converts $ref into a PascalCase type reference", () => {
    expect(schemaToTSType({ $ref: "#/components/schemas/user-profile" })).toBe("UserProfile");
    expect(schemaToTSType({ $ref: "#/components/schemas/user_profile" })).toBe("UserProfile");
    expect(schemaToTSType({ $ref: "#/components/schemas/UserProfile" })).toBe("UserProfile");
  });

  it("joins allOf members with '&'", () => {
    const schema: SchemaObject = { allOf: [{ type: "string" }, { $ref: "#/components/schemas/Tag" }] };
    expect(schemaToTSType(schema)).toBe("string & Tag");
  });

  it("joins anyOf/oneOf members with '|'", () => {
    expect(schemaToTSType({ anyOf: [{ type: "string" }, { type: "number" }] })).toBe("string | number");
    expect(schemaToTSType({ oneOf: [{ type: "boolean" }, { type: "null" }] })).toBe("boolean | null");
  });

  it("renders enum values as a literal union", () => {
    expect(schemaToTSType({ enum: ["a", "b", 1] })).toBe('"a" | "b" | 1');
  });

  it("builds an object type with required and optional fields", () => {
    const schema: SchemaObject = {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        nickname: { type: "string" },
      },
    };
    const result = schemaToTSType(schema);
    expect(result).toContain("id: string");
    expect(result).toContain("nickname?: string");
  });

  it("quotes object keys that are not valid identifiers", () => {
    const schema: SchemaObject = {
      type: "object",
      properties: { "user-id": { type: "string" } },
    };
    expect(schemaToTSType(schema)).toContain("'user-id'?: string");
  });

  it("includes a JSDoc comment for properties that have a description", () => {
    const schema: SchemaObject = {
      type: "object",
      properties: { id: { type: "string", description: "The user id" } },
    };
    expect(schemaToTSType(schema)).toContain("/** The user id */");
  });

  it('returns "Record<string, unknown>" for an object schema with no properties', () => {
    expect(schemaToTSType({ type: "object" })).toBe("Record<string, unknown>");
  });

  it("treats a schema with properties but no explicit type as an object", () => {
    const schema: SchemaObject = { properties: { id: { type: "string" } } };
    expect(schemaToTSType(schema)).toContain("id?: string");
  });

  it('falls back to "unknown" for a schema with no type and no properties', () => {
    expect(schemaToTSType({})).toBe("unknown");
  });
});

describe("operationToTypeName", () => {
  it("uppercases the first letter of the operationId", () => {
    expect(operationToTypeName("listUsers")).toBe("ListUsers");
  });

  it("leaves an already-uppercase first letter unchanged", () => {
    expect(operationToTypeName("ListUsers")).toBe("ListUsers");
  });
});

describe("generateTypesFile", () => {
  function endpoint(overrides: Partial<ParsedEndpoint> = {}): ParsedEndpoint {
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

  it("emits component schemas before endpoint types, each in its own section", () => {
    const output = generateTypesFile([], { User: { type: "object", properties: { id: { type: "string" } } } });
    expect(output).toContain("Component Schemas");
    expect(output).toContain("export type User = {");
    expect(output).not.toContain("Endpoint Types");
  });

  it("generates a PathParams interface for endpoints with path parameters", () => {
    const ep = endpoint({ pathParams: [{ name: "id", required: true, schema: { type: "string" } }] });
    const output = generateTypesFile([ep]);
    expect(output).toContain("export interface GetUserPathParams {");
    expect(output).toContain("id: string");
  });

  it("marks non-required query params as optional in QueryParams interface", () => {
    const ep = endpoint({
      queryParams: [
        { name: "page", required: true, schema: { type: "number" } },
        { name: "expand", required: false, schema: { type: "boolean" } },
      ],
    });
    const output = generateTypesFile([ep]);
    expect(output).toContain("page: number");
    expect(output).toContain("expand?: boolean");
  });

  it("emits an inline Body type when the request body schema is not a $ref", () => {
    const ep = endpoint({ bodySchema: { type: "object", properties: { name: { type: "string" } } } });
    const output = generateTypesFile([ep]);
    expect(output).toContain("export type GetUserBody = {");
  });

  it("emits an alias for a Body $ref that points to a registered component", () => {
    const ep = endpoint({ bodySchema: { $ref: "#/components/schemas/User" } });
    const output = generateTypesFile([ep], { User: { type: "object", properties: {} } });
    expect(output).toContain("export type GetUserBody = User");
  });

  it("does not emit a redundant alias when the computed alias name equals the component name", () => {
    // operationId "User" + "Body" suffix produces alias name "UserBody",
    // which matches a component of the same name -> no alias line emitted.
    const ep = endpoint({ operationId: "User", bodySchema: { $ref: "#/components/schemas/UserBody" } });
    const output = generateTypesFile([ep], { UserBody: { type: "object", properties: {} } });

    const matches = output.match(/UserBody/g) ?? [];
    // Should appear only once: in the component's own declaration line.
    expect(matches).toHaveLength(1);
    expect(output).toContain("export type UserBody = Record<string, unknown>");
  });

  it("deduplicates identical type names using first-writer-wins", () => {
    const epA = endpoint({ operationId: "getUser", responseSchema: { type: "string" } });
    const epB = endpoint({ operationId: "getUser", responseSchema: { type: "number" } });
    const output = generateTypesFile([epA, epB]);

    const matches = output.match(/export type GetUserResponse/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(output).toContain("export type GetUserResponse = string");
    expect(output).not.toContain("export type GetUserResponse = number");
  });

  it("references an unresolvable $ref by name even if it has no matching component", () => {
    const ep = endpoint({ bodySchema: { $ref: "#/components/schemas/External" } });
    const output = generateTypesFile([ep]);
    expect(output).toContain("export type GetUserBody = External");
  });
});
