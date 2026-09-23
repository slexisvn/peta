import fs from "node:fs";
import path from "node:path";
import { PetaError } from "../core/errors.js";
import { configPath } from "../core/home.js";

export class ConfigError extends PetaError {}

export type RegistryConfig = {
  readonly registry: string | null;
};

const FILE_MODE = 0o600;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readRegistryConfig(): RegistryConfig {
  const target = configPath();
  if (!fs.existsSync(target)) return { registry: null };
  let source: unknown;
  try {
    source = JSON.parse(fs.readFileSync(target, "utf8"));
  } catch {
    throw new ConfigError(`${target} is not valid JSON; fix or delete it`);
  }
  if (!isRecord(source)) throw new ConfigError(`${target} should hold a configuration object`);
  const registry = source.registry;
  if (registry === undefined) return { registry: null };
  if (typeof registry !== "string" || registry.length === 0) {
    throw new ConfigError(`${target} field 'registry' should be a non-empty string`);
  }
  return { registry };
}

function writeRegistryConfig(config: RegistryConfig): void {
  const target = configPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const document: Record<string, string> = {};
  if (config.registry !== null) document.registry = config.registry;
  fs.writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`, {
    encoding: "utf8",
    mode: FILE_MODE,
  });
  try {
    fs.chmodSync(target, FILE_MODE);
  } catch {
    return;
  }
}

export function configuredRegistry(): string | null {
  return readRegistryConfig().registry;
}

export function rememberRegistry(registry: string): void {
  writeRegistryConfig({ registry });
}

export function forgetRegistry(): boolean {
  const existing = readRegistryConfig();
  if (existing.registry === null) return false;
  writeRegistryConfig({ registry: null });
  return true;
}
