import fs from "node:fs";
import path from "node:path";
import { ContentError, isUnsafePath, requireAllowed } from "./content.js";
import { modulePathOf, parsePackageName, type PackageName } from "./name.js";
import { packagesPathIn, statePathIn } from "./project.js";
import { formatResolvedSource, parseResolvedSource, type ResolvedSource } from "./source.js";
import { formatVersion, parseVersion, type Version } from "./version.js";
import { PetaError } from "./errors.js";

export class TreeError extends PetaError {}

export const STATE_VERSION = 1;

export type InstalledPackage = {
  readonly name: PackageName;
  readonly version: Version;
  readonly source: ResolvedSource;
  readonly files: number;
};

export type TreeState = {
  readonly packages: ReadonlyMap<string, InstalledPackage>;
};

export type PackageContents = {
  readonly name: PackageName;
  readonly version: Version;
  readonly source: ResolvedSource;
  readonly directory: string;
};

function collect(root: string, prefix = ""): readonly string[] {
  const entries = fs.readdirSync(path.join(root, prefix), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relative = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isSymbolicLink()) {
      throw new ContentError(`'${relative}' is a symbolic link, which a package may not contain`);
    }
    if (entry.isDirectory()) {
      files.push(...collect(root, relative));
      continue;
    }
    if (!entry.isFile()) continue;
    files.push(relative);
  }
  return files;
}

export function packageFiles(directory: string): readonly string[] {
  const files = collect(directory);
  for (const file of files) {
    if (isUnsafePath(file)) throw new ContentError(`'${file}' escapes the package root`);
    requireAllowed(file);
  }
  return [...files].sort();
}

function copyFiles(from: string, to: string, files: readonly string[]): void {
  for (const file of files) {
    const target = path.join(to, ...file.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(from, ...file.split("/")), target);
  }
}

function pruneEmpty(directory: string, stopAt: string): void {
  let current = directory;
  while (current.startsWith(stopAt) && current !== stopAt) {
    if (!fs.existsSync(current) || fs.readdirSync(current).length > 0) return;
    fs.rmdirSync(current);
    current = path.dirname(current);
  }
}

export function installedPathFor(root: string, name: PackageName): string {
  return path.join(packagesPathIn(root), modulePathOf(name, path.sep));
}

export function readState(root: string): TreeState {
  const target = statePathIn(root);
  if (!fs.existsSync(target)) return { packages: new Map() };
  const source = JSON.parse(fs.readFileSync(target, "utf8")) as {
    stateVersion?: number;
    packages?: Record<string, { version: string; source: string; files: number }>;
  };
  if (source.stateVersion !== STATE_VERSION) return { packages: new Map() };
  const packages = new Map<string, InstalledPackage>();
  for (const [key, entry] of Object.entries(source.packages ?? {})) {
    packages.set(key, {
      name: parsePackageName(key),
      version: parseVersion(entry.version),
      source: parseResolvedSource(entry.source),
      files: entry.files,
    });
  }
  return { packages };
}

export function writeState(root: string, state: TreeState): void {
  const target = statePathIn(root);
  const packages: Record<string, unknown> = {};
  for (const key of [...state.packages.keys()].sort()) {
    const entry = state.packages.get(key)!;
    packages[key] = {
      version: formatVersion(entry.version),
      source: formatResolvedSource(entry.source),
      files: entry.files,
    };
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    target,
    `${JSON.stringify({ stateVersion: STATE_VERSION, packages }, null, 2)}\n`,
    "utf8",
  );
}

export type SyncOutcome = {
  readonly added: readonly string[];
  readonly updated: readonly string[];
  readonly removed: readonly string[];
  readonly unchanged: readonly string[];
};

function sameInstall(left: InstalledPackage, right: PackageContents, files: number): boolean {
  if (right.source.kind === "path") return false;
  return (
    formatVersion(left.version) === formatVersion(right.version) &&
    formatResolvedSource(left.source) === formatResolvedSource(right.source) &&
    left.files === files
  );
}

export function syncTree(root: string, contents: readonly PackageContents[]): SyncOutcome {
  const packagesRoot = packagesPathIn(root);
  const previous = readState(root);
  const added: string[] = [];
  const updated: string[] = [];
  const unchanged: string[] = [];
  const next = new Map<string, InstalledPackage>();

  for (const entry of contents) {
    const files = packageFiles(entry.directory);
    const target = installedPathFor(root, entry.name);
    const before = previous.packages.get(entry.name.text);
    const installed: InstalledPackage = {
      name: entry.name,
      version: entry.version,
      source: entry.source,
      files: files.length,
    };
    next.set(entry.name.text, installed);
    if (before !== undefined && sameInstall(before, entry, files.length) && fs.existsSync(target)) {
      unchanged.push(entry.name.text);
      continue;
    }
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(target, { recursive: true });
    copyFiles(entry.directory, target, files);
    (before === undefined ? added : updated).push(entry.name.text);
  }

  const removed: string[] = [];
  for (const [key, entry] of previous.packages) {
    if (next.has(key)) continue;
    const target = installedPathFor(root, entry.name);
    fs.rmSync(target, { recursive: true, force: true });
    pruneEmpty(path.dirname(target), packagesRoot);
    removed.push(key);
  }

  writeState(root, { packages: next });
  return {
    added: added.sort(),
    updated: updated.sort(),
    removed: removed.sort(),
    unchanged: unchanged.sort(),
  };
}
