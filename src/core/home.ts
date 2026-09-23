import os from "node:os";
import path from "node:path";

export const HOME_VARIABLE = "TERA_HOME";
export const HOME_DIRECTORY = ".tera";

export function teraHome(): string {
  const override = process.env[HOME_VARIABLE];
  if (override !== undefined && override.length > 0) return path.resolve(override);
  return path.join(os.homedir(), HOME_DIRECTORY);
}

export function cacheDirectory(): string {
  return path.join(teraHome(), "cache");
}

export function gitCacheDirectory(): string {
  return path.join(cacheDirectory(), "git");
}

export function archiveCacheDirectory(): string {
  return path.join(cacheDirectory(), "archive");
}

export function credentialsPath(): string {
  return path.join(teraHome(), "credentials");
}

export function configPath(): string {
  return path.join(teraHome(), "config");
}
