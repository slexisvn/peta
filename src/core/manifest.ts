import { ManifestError } from "./errors.js";
import { compareNames, parsePackageName, type NameOptions, type PackageName } from "./name.js";
import {
  formatDependencySource,
  parseDependencySource,
  type DependencySource,
} from "./source.js";
import { formatVersion, parseVersion, type Version } from "./version.js";

export const MANIFEST_FILE = "tera.json";
export const DEFAULT_MODULES = "src";

export type DependencyKind = "dependencies" | "devDependencies";

export type Dependency = {
  readonly name: PackageName;
  readonly source: DependencySource;
};

export type Manifest = {
  readonly name: PackageName | null;
  readonly version: Version | null;
  readonly description: string | null;
  readonly license: string | null;
  readonly repository: string | null;
  readonly modules: string;
  readonly dependencies: readonly Dependency[];
  readonly devDependencies: readonly Dependency[];
  readonly tasks: ReadonlyMap<string, string>;
  readonly include: readonly string[];
};

const KNOWN_FIELDS: ReadonlySet<string> = new Set([
  "name",
  "version",
  "description",
  "license",
  "repository",
  "modules",
  "dependencies",
  "devDependencies",
  "tasks",
  "include",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalText(
  source: Record<string, unknown>,
  field: string,
  path: readonly string[],
): string | null {
  const value = source[field];
  if (value === undefined) return null;
  if (typeof value !== "string" || value.length === 0) {
    throw new ManifestError([...path, field], "expected a non-empty string");
  }
  return value;
}

function relativeDirectory(text: string, path: readonly string[]): string {
  const normalized = text.replace(/\\/g, "/").replace(/\/+$/, "");
  if (normalized.length === 0) return ".";
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
    throw new ManifestError(path, `expected a relative path, got '${text}'`);
  }
  if (normalized.split("/").includes("..")) {
    throw new ManifestError(path, `must not escape the package root, got '${text}'`);
  }
  return normalized;
}

function parseDependencies(
  source: Record<string, unknown>,
  field: DependencyKind,
  options: NameOptions,
): readonly Dependency[] {
  const value = source[field];
  if (value === undefined) return [];
  if (!isRecord(value)) throw new ManifestError([field], "expected an object");
  const dependencies = Object.entries(value).map(([key, requirement]) => {
    try {
      return {
        name: parsePackageName(key, options),
        source: parseDependencySource(requirement),
      };
    } catch (error) {
      throw new ManifestError(
        [field, key],
        error instanceof Error ? error.message : String(error),
      );
    }
  });
  return [...dependencies].sort((left, right) => compareNames(left.name, right.name));
}

function parseTasks(source: Record<string, unknown>): ReadonlyMap<string, string> {
  const value = source["tasks"];
  if (value === undefined) return new Map();
  if (!isRecord(value)) throw new ManifestError(["tasks"], "expected an object");
  const tasks = new Map<string, string>();
  for (const [key, command] of Object.entries(value)) {
    if (typeof command !== "string" || command.length === 0) {
      throw new ManifestError(["tasks", key], "expected a non-empty command string");
    }
    tasks.set(key, command);
  }
  return tasks;
}

function parseInclude(source: Record<string, unknown>): readonly string[] {
  const value = source["include"];
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ManifestError(["include"], "expected an array of patterns");
  return value.map((pattern, at) => {
    if (typeof pattern !== "string" || pattern.length === 0) {
      throw new ManifestError(["include", String(at)], "expected a non-empty pattern");
    }
    return pattern;
  });
}

function parseIdentity(
  source: Record<string, unknown>,
  options: NameOptions,
): { name: PackageName | null; version: Version | null } {
  const nameText = optionalText(source, "name", []);
  const versionText = optionalText(source, "version", []);
  if (nameText !== null && versionText === null) {
    throw new ManifestError(["version"], "a named package must declare a version");
  }
  if (versionText !== null && nameText === null) {
    throw new ManifestError(["name"], "a versioned package must declare a name");
  }
  if (nameText === null || versionText === null) return { name: null, version: null };
  try {
    return { name: parsePackageName(nameText, options), version: parseVersion(versionText) };
  } catch (error) {
    throw new ManifestError([], error instanceof Error ? error.message : String(error));
  }
}

export type ManifestOptions = NameOptions;

export function parseManifest(text: string, options: ManifestOptions = {}): Manifest {
  let source: unknown;
  try {
    source = JSON.parse(text);
  } catch (error) {
    throw new ManifestError([], `not valid JSON: ${error instanceof Error ? error.message : ""}`);
  }
  if (!isRecord(source)) throw new ManifestError([], "expected a JSON object");
  for (const field of Object.keys(source)) {
    if (!KNOWN_FIELDS.has(field)) throw new ManifestError([field], "unknown field");
  }
  const identity = parseIdentity(source, options);
  const modulesText = optionalText(source, "modules", []);
  return {
    name: identity.name,
    version: identity.version,
    description: optionalText(source, "description", []),
    license: optionalText(source, "license", []),
    repository: optionalText(source, "repository", []),
    modules: modulesText === null ? DEFAULT_MODULES : relativeDirectory(modulesText, ["modules"]),
    dependencies: parseDependencies(source, "dependencies", options),
    devDependencies: parseDependencies(source, "devDependencies", options),
    tasks: parseTasks(source),
    include: parseInclude(source),
  };
}

export function emptyManifest(): Manifest {
  return {
    name: null,
    version: null,
    description: null,
    license: null,
    repository: null,
    modules: DEFAULT_MODULES,
    dependencies: [],
    devDependencies: [],
    tasks: new Map(),
    include: [],
  };
}

function dependencyRecord(
  dependencies: readonly Dependency[],
): Record<string, string | Record<string, string>> {
  const record: Record<string, string | Record<string, string>> = {};
  for (const dependency of dependencies) {
    record[dependency.name.text] = formatDependencySource(dependency.source);
  }
  return record;
}

export function formatManifest(manifest: Manifest): string {
  const document: Record<string, unknown> = {};
  if (manifest.name !== null && manifest.version !== null) {
    document["name"] = manifest.name.text;
    document["version"] = formatVersion(manifest.version);
  }
  if (manifest.description !== null) document["description"] = manifest.description;
  if (manifest.license !== null) document["license"] = manifest.license;
  if (manifest.repository !== null) document["repository"] = manifest.repository;
  document["modules"] = manifest.modules;
  document["dependencies"] = dependencyRecord(manifest.dependencies);
  if (manifest.devDependencies.length > 0) {
    document["devDependencies"] = dependencyRecord(manifest.devDependencies);
  }
  if (manifest.tasks.size > 0) document["tasks"] = Object.fromEntries(manifest.tasks);
  if (manifest.include.length > 0) document["include"] = manifest.include;
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function withDependency(
  manifest: Manifest,
  kind: DependencyKind,
  dependency: Dependency,
): Manifest {
  const existing = manifest[kind].filter((entry) => entry.name.text !== dependency.name.text);
  const updated = [...existing, dependency].sort((left, right) =>
    compareNames(left.name, right.name),
  );
  return { ...manifest, [kind]: updated };
}

export function allDependencies(manifest: Manifest, includeDev: boolean): readonly Dependency[] {
  if (!includeDev) return manifest.dependencies;
  return [...manifest.dependencies, ...manifest.devDependencies].sort((left, right) =>
    compareNames(left.name, right.name),
  );
}

export function findDependency(manifest: Manifest, name: PackageName): Dependency | undefined {
  return allDependencies(manifest, true).find((entry) => entry.name.text === name.text);
}

export function withoutDependency(manifest: Manifest, name: PackageName): Manifest {
  return {
    ...manifest,
    dependencies: manifest.dependencies.filter((entry) => entry.name.text !== name.text),
    devDependencies: manifest.devDependencies.filter((entry) => entry.name.text !== name.text),
  };
}
