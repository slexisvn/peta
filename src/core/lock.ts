import { PetaError } from "./errors.js";
import { compareNames, parsePackageName, type NameOptions, type PackageName } from "./name.js";
import {
  formatResolvedSource,
  parseResolvedSource,
  type ResolvedSource,
} from "./source.js";
import { formatVersion, parseVersion, type Version } from "./version.js";

export const LOCK_VERSION = 1;

export class LockError extends PetaError {
  constructor(readonly path: readonly string[], message: string) {
    super(path.length === 0 ? message : `${path.join(".")}: ${message}`);
  }
}

export type LockedPackage = {
  readonly name: PackageName;
  readonly version: Version;
  readonly source: ResolvedSource;
  readonly integrity: string | null;
  readonly dependencies: readonly PackageName[];
};

export type LockFile = {
  readonly root: PackageName | null;
  readonly packages: ReadonlyMap<string, LockedPackage>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredText(
  source: Record<string, unknown>,
  field: string,
  path: readonly string[],
): string {
  const value = source[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new LockError([...path, field], "expected a non-empty string");
  }
  return value;
}

function parseDependencyNames(
  source: Record<string, unknown>,
  path: readonly string[],
  options: NameOptions,
): readonly PackageName[] {
  const value = source["dependencies"];
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new LockError([...path, "dependencies"], "expected an array");
  const names = value.map((entry, at) => {
    if (typeof entry !== "string") {
      throw new LockError([...path, "dependencies", String(at)], "expected a package name");
    }
    return parsePackageName(entry, options);
  });
  return [...names].sort(compareNames);
}

function parsePackageEntry(
  key: string,
  value: unknown,
  options: NameOptions,
): LockedPackage {
  const path = ["packages", key];
  if (!isRecord(value)) throw new LockError(path, "expected an object");
  const integrity = value["integrity"];
  if (integrity !== undefined && typeof integrity !== "string") {
    throw new LockError([...path, "integrity"], "expected a string");
  }
  try {
    return {
      name: parsePackageName(key, options),
      version: parseVersion(requiredText(value, "version", path)),
      source: parseResolvedSource(requiredText(value, "source", path)),
      integrity: integrity ?? null,
      dependencies: parseDependencyNames(value, path, options),
    };
  } catch (error) {
    if (error instanceof LockError) throw error;
    throw new LockError(path, error instanceof Error ? error.message : String(error));
  }
}

export function emptyLock(root: PackageName | null = null): LockFile {
  return { root, packages: new Map() };
}

export function parseLock(text: string, options: NameOptions = {}): LockFile {
  let source: unknown;
  try {
    source = JSON.parse(text);
  } catch (error) {
    throw new LockError([], `not valid JSON: ${error instanceof Error ? error.message : ""}`);
  }
  if (!isRecord(source)) throw new LockError([], "expected a JSON object");
  const lockVersion = source["lockVersion"];
  if (lockVersion !== LOCK_VERSION) {
    throw new LockError(["lockVersion"], `expected ${LOCK_VERSION}, got ${String(lockVersion)}`);
  }
  const rootText = source["root"];
  if (rootText !== undefined && typeof rootText !== "string") {
    throw new LockError(["root"], "expected a package name");
  }
  const packages = source["packages"];
  if (packages !== undefined && !isRecord(packages)) {
    throw new LockError(["packages"], "expected an object");
  }
  const entries = new Map<string, LockedPackage>();
  for (const [key, value] of Object.entries(packages ?? {})) {
    entries.set(key, parsePackageEntry(key, value, options));
  }
  return {
    root: rootText === undefined ? null : parsePackageName(rootText, options),
    packages: entries,
  };
}

export function formatLock(lock: LockFile): string {
  const packages: Record<string, unknown> = {};
  for (const locked of sortedPackages(lock)) {
    const entry: Record<string, unknown> = {
      version: formatVersion(locked.version),
      source: formatResolvedSource(locked.source),
    };
    if (locked.integrity !== null) entry["integrity"] = locked.integrity;
    if (locked.dependencies.length > 0) {
      entry["dependencies"] = locked.dependencies.map((name) => name.text);
    }
    packages[locked.name.text] = entry;
  }
  const document: Record<string, unknown> = { lockVersion: LOCK_VERSION };
  if (lock.root !== null) document["root"] = lock.root.text;
  document["packages"] = packages;
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function sortedPackages(lock: LockFile): readonly LockedPackage[] {
  return [...lock.packages.values()].sort((left, right) => compareNames(left.name, right.name));
}

export function dependentsOf(lock: LockFile, name: PackageName): readonly PackageName[] {
  return sortedPackages(lock)
    .filter((locked) => locked.dependencies.some((entry) => entry.text === name.text))
    .map((locked) => locked.name);
}
