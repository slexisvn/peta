import { PetaError } from "../core/errors.js";
import { compareNames, parsePackageName, type NameOptions, type PackageName } from "../core/name.js";
import { formatRange, parseRange, type Range } from "../core/range.js";
import { compareVersion, formatVersion, parseVersion, type Version } from "../core/version.js";

export class IndexError extends PetaError {
  constructor(readonly path: readonly string[], message: string) {
    super(path.length === 0 ? message : `${path.join(".")}: ${message}`);
  }
}

export type IndexRequirement = {
  readonly name: PackageName;
  readonly range: Range;
};

export type IndexEntry = {
  readonly version: Version;
  readonly dependencies: readonly IndexRequirement[];
  readonly integrity: string;
  readonly archive: string;
  readonly yanked: boolean;
};

export type PackageIndex = {
  readonly name: PackageName;
  readonly entries: readonly IndexEntry[];
};

export const INDEX_DIRECTORY = "index";
export const ARCHIVE_DIRECTORY = "pkg";

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
    throw new IndexError([...path, field], "expected a non-empty string");
  }
  return value;
}

function parseRequirements(
  source: Record<string, unknown>,
  path: readonly string[],
  options: NameOptions,
): readonly IndexRequirement[] {
  const value = source["dependencies"];
  if (value === undefined) return [];
  if (!isRecord(value)) throw new IndexError([...path, "dependencies"], "expected an object");
  const requirements = Object.entries(value).map(([key, range]) => {
    if (typeof range !== "string") {
      throw new IndexError([...path, "dependencies", key], "expected a version range string");
    }
    try {
      return { name: parsePackageName(key, options), range: parseRange(range) };
    } catch (error) {
      throw new IndexError(
        [...path, "dependencies", key],
        error instanceof Error ? error.message : String(error),
      );
    }
  });
  return [...requirements].sort((left, right) => compareNames(left.name, right.name));
}

function parseEntry(value: unknown, at: number, options: NameOptions): IndexEntry {
  const path = ["versions", String(at)];
  if (!isRecord(value)) throw new IndexError(path, "expected an object");
  const yanked = value["yanked"];
  if (yanked !== undefined && typeof yanked !== "boolean") {
    throw new IndexError([...path, "yanked"], "expected a boolean");
  }
  return {
    version: parseVersion(requiredText(value, "version", path)),
    dependencies: parseRequirements(value, path, options),
    integrity: requiredText(value, "integrity", path),
    archive: requiredText(value, "archive", path),
    yanked: yanked ?? false,
  };
}

export function parsePackageIndex(text: string, options: NameOptions = {}): PackageIndex {
  let source: unknown;
  try {
    source = JSON.parse(text);
  } catch (error) {
    throw new IndexError([], `not valid JSON: ${error instanceof Error ? error.message : ""}`);
  }
  if (!isRecord(source)) throw new IndexError([], "expected a JSON object");
  const versions = source["versions"];
  if (!Array.isArray(versions)) throw new IndexError(["versions"], "expected an array");
  const entries = versions.map((entry, at) => parseEntry(entry, at, options));
  const seen = new Set<string>();
  for (const entry of entries) {
    const text = formatVersion(entry.version);
    if (seen.has(text)) throw new IndexError(["versions"], `duplicate version ${text}`);
    seen.add(text);
  }
  return {
    name: parsePackageName(requiredText(source, "name", []), options),
    entries: [...entries].sort((left, right) => compareVersion(left.version, right.version)),
  };
}

export function formatPackageIndex(index: PackageIndex): string {
  const versions = index.entries.map((entry) => {
    const dependencies: Record<string, string> = {};
    for (const requirement of entry.dependencies) {
      dependencies[requirement.name.text] = formatRange(requirement.range);
    }
    const document: Record<string, unknown> = { version: formatVersion(entry.version) };
    if (entry.dependencies.length > 0) document["dependencies"] = dependencies;
    document["integrity"] = entry.integrity;
    document["archive"] = entry.archive;
    if (entry.yanked) document["yanked"] = true;
    return document;
  });
  return `${JSON.stringify({ name: index.name.text, versions }, null, 2)}\n`;
}

export function indexPathFor(name: PackageName): string {
  return `${INDEX_DIRECTORY}/${name.segments.join("/")}.json`;
}

export function archivePathFor(name: PackageName, version: Version): string {
  return `${ARCHIVE_DIRECTORY}/${name.text}/${formatVersion(version)}.tpkg`;
}

export function selectableEntries(index: PackageIndex): readonly IndexEntry[] {
  return index.entries.filter((entry) => !entry.yanked);
}

export function entryFor(index: PackageIndex, version: Version): IndexEntry | undefined {
  return index.entries.find((entry) => compareVersion(entry.version, version) === 0);
}
