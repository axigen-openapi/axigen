import path from "node:path";
import fs from "node:fs";
import type { AxigenConfig, FunctionNameConfig } from "../types.js";
import { pathToFileURL } from "node:url";

const CONFIG_FILES = ["axigen.config.js", "axigen.config.cjs", "axigen.config.mjs", "axigen.config.ts"];

export async function loadConfig(cwd: string, configPath?: string): Promise<AxigenConfig> {
  // Use the user-specified config path if provided
  if (configPath) {
    const abs = path.resolve(cwd, configPath);
    if (!fs.existsSync(abs)) {
      throw new Error(`Config file not found: ${abs}`);
    }
    return importConfig(abs);
  }

  // Search default config file locations
  for (const filename of CONFIG_FILES) {
    const abs = path.join(cwd, filename);
    if (fs.existsSync(abs)) {
      return importConfig(abs);
    }
  }

  throw new Error(`No config file found. Create one of: ${CONFIG_FILES.join(", ")}\n` + `Or run: axigen init`);
}

async function importConfig(filePath: string): Promise<AxigenConfig> {
  let raw: unknown;

  try {
    // Dynamic import works for both ESM and CJS
    const mod = await import(pathToFileURL(filePath).href);
    raw = mod.default ?? mod;
  } catch {
    throw new Error(`Failed to load config: ${filePath}`);
  }

  return validateConfig(raw, filePath);
}

function validateConfig(raw: unknown, filePath: string): AxigenConfig {
  if (!raw || typeof raw !== "object") {
    throw new Error(`Invalid config in ${filePath}: must export an object`);
  }

  const cfg = raw as Record<string, unknown>;

  if (!cfg.input || typeof cfg.input !== "string") {
    throw new Error(`Config error: "input" must be a string path to your OpenAPI file`);
  }

  if (!cfg.output || typeof cfg.output !== "object") {
    throw new Error(`Config error: "output" must be an object with at least "client" path`);
  }

  const output = cfg.output as Record<string, unknown>;
  if (!output.client || typeof output.client !== "string") {
    throw new Error(`Config error: "output.client" is required`);
  }

  if (!cfg.axiosInstancePath || typeof cfg.axiosInstancePath !== "string") {
    throw new Error(`Config error: "axiosInstancePath" is required (path to your axios instance)`);
  }

  return {
    input: cfg.input,
    output: {
      client: output.client,
      types: typeof output.types === "string" ? output.types : undefined,
    },
    axiosInstancePath: cfg.axiosInstancePath as string,
    axiosInstanceExport: typeof cfg.axiosInstanceExport === "string" ? cfg.axiosInstanceExport : "axiosInstance",
    language: cfg.language === "js" ? "js" : "ts",
    jsdoc: cfg.jsdoc !== false,
    tags: Array.isArray(cfg.tags) ? (cfg.tags as string[]) : undefined,
    functionName: validateFunctionNameConfig(cfg.functionName, filePath),
  };
}

function validateFunctionNameConfig(raw: unknown, filePath: string): FunctionNameConfig | undefined {
  if (raw === undefined || raw === null) return undefined;

  if (typeof raw !== "object") {
    throw new Error(`Config error: "functionName" must be an object`);
  }

  const fn = raw as Record<string, unknown>;
  const result: FunctionNameConfig = {};

  // Validate transforms
  if (fn.transforms !== undefined) {
    if (!Array.isArray(fn.transforms)) {
      throw new Error(`Config error: "functionName.transforms" must be an array`);
    }

    result.transforms = fn.transforms.map((t: unknown, i: number) => {
      if (!t || typeof t !== "object") {
        throw new Error(`Config error: "functionName.transforms[${i}]" must be an object`);
      }
      const transform = t as Record<string, unknown>;

      if (typeof transform.match !== "string") {
        throw new Error(`Config error: "functionName.transforms[${i}].match" must be a string regex pattern`);
      }
      if (typeof transform.replacement !== "string") {
        throw new Error(`Config error: "functionName.transforms[${i}].replacement" must be a string`);
      }

      // Validate the regex before accepting it
      try {
        new RegExp(transform.match as string, (transform.flags as string | undefined) ?? "g");
      } catch {
        throw new Error(`Config error: "functionName.transforms[${i}].match" is not a valid regex: ${transform.match}`);
      }

      return {
        match: transform.match as string,
        flags: typeof transform.flags === "string" ? transform.flags : "g",
        replacement: transform.replacement as string,
      };
    });
  }

  // Validate appendMethod
  if (fn.appendMethod !== undefined) {
    if (typeof fn.appendMethod !== "boolean" && !Array.isArray(fn.appendMethod)) {
      throw new Error(`Config error: "functionName.appendMethod" must be a boolean or an array of HTTP methods`);
    }
    result.appendMethod = fn.appendMethod as FunctionNameConfig["appendMethod"];
  }

  return result;
}
