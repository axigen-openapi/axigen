import { describe, it, expect } from "vitest";
import { resolveFunctionName } from "../function-name";
import type { FunctionNameConfig } from "../../types";

describe("resolveFunctionName", () => {
  it("returns the operationId unchanged (as-is) when no config is provided", () => {
    expect(resolveFunctionName("GetUsersByUserId", "get", undefined)).toBe("GetUsersByUserId");
  });

  it("lowercases the first letter when appendMethod is not set", () => {
    const config: FunctionNameConfig = {};
    expect(resolveFunctionName("GetUsersByUserId", "get", config)).toBe("getUsersByUserId");
  });

  it("prepends the method (not appends) when appendMethod is true", () => {
    const config: FunctionNameConfig = { appendMethod: true };
    expect(resolveFunctionName("UsersByUserId", "get", config)).toBe("getUsersByUserId");
  });

  it("prepends the method only for methods listed in appendMethod array", () => {
    const config: FunctionNameConfig = { appendMethod: ["post", "put"] };
    expect(resolveFunctionName("CreateUser", "post", config)).toBe("postCreateUser");
    expect(resolveFunctionName("ListUsers", "get", config)).toBe("listUsers");
  });

  it("matches appendMethod entries case-insensitively", () => {
    const config: FunctionNameConfig = { appendMethod: ["POST"] as any };
    expect(resolveFunctionName("CreateUser", "post", config)).toBe("postCreateUser");
  });

  it("applies a kebab-case-to-camelCase transform before the method prefix logic", () => {
    const config: FunctionNameConfig = {
      transforms: [{ match: "-([a-zA-Z])", flags: "g", replacement: "upper:$1" }],
    };
    expect(resolveFunctionName("product-variant-create", "post", config)).toBe("productVariantCreate");
  });

  it("applies multiple transforms in order", () => {
    const config: FunctionNameConfig = {
      transforms: [
        { match: "-([a-zA-Z])", flags: "g", replacement: "upper:$1" },
        { match: "Create$", replacement: "New" },
      ],
    };
    expect(resolveFunctionName("product-create", "post", config)).toBe("productNew");
  });

  it("supports lower: token in transforms", () => {
    const config: FunctionNameConfig = {
      transforms: [{ match: "^([A-Z])", replacement: "lower:$1" }],
    };
    expect(resolveFunctionName("Users", "get", config)).toBe("users");
  });

  it("supports standard $1-style replacement strings", () => {
    const config: FunctionNameConfig = {
      transforms: [{ match: "^Get", replacement: "Fetch" }],
    };
    expect(resolveFunctionName("GetUsers", "get", config)).toBe("fetchUsers");
  });

  it("combines transforms with appendMethod=true", () => {
    const config: FunctionNameConfig = {
      transforms: [{ match: "-([a-zA-Z])", flags: "g", replacement: "upper:$1" }],
      appendMethod: true,
    };
    expect(resolveFunctionName("product-variant", "delete", config)).toBe("deleteProductVariant");
  });

  it("returns an empty string safely when appendMethod=false and input is empty", () => {
    const config: FunctionNameConfig = { appendMethod: false };
    expect(resolveFunctionName("", "get", config)).toBe("");
  });
});
