import path from "node:path";
import { LocalSourceFetcher, type SourceFetcher } from "./checkout.js";
import { PetaError } from "./errors.js";
import { emptyLock, formatLock, type LockFile, type LockedPackage } from "./lock.js";
import { allDependencies, type Manifest, type ManifestOptions } from "./manifest.js";
import { compareNames, parsePackageName, type PackageName } from "./name.js";
import { ProjectProvider } from "./provider.js";
import { readLock, writeLock, type Project } from "./project.js";
import { DEFAULT_REGISTRY, type ResolvedSource } from "./source.js";
import { syncTree, type PackageContents, type SyncOutcome } from "./tree.js";
import { solve } from "../solver/solve.js";
import { configuredRegistry, type Registry } from "../registry/registry.js";
import { RegistryStore } from "../registry/store.js";
import type { Version } from "./version.js";

export class InstallError extends PetaError {}

export type InstallOptions = {
  readonly includeDev?: boolean;
  readonly frozen?: boolean;
  readonly fetcher?: SourceFetcher;
  readonly names?: ManifestOptions;
  readonly registry?: Registry | null;
  readonly previous?: LockFile | null;
  readonly refresh?: readonly string[] | null;
};

export type Resolution = {
  readonly lock: LockFile;
  readonly contents: readonly PackageContents[];
};

export type InstallReport = {
  readonly lock: LockFile;
  readonly outcome: SyncOutcome;
  readonly lockChanged: boolean;
};

function directoryOf(checkoutDirectory: string, manifest: Manifest): string {
  return path.resolve(checkoutDirectory, manifest.modules);
}

function preferencesFrom(
  lock: LockFile | null,
  refresh: readonly string[] | null,
): ReadonlyMap<string, Version> {
  const preferred = new Map<string, Version>();
  if (lock === null || (refresh !== null && refresh.length === 0)) return preferred;
  const stale = new Set(refresh ?? []);
  for (const locked of lock.packages.values()) {
    if (stale.has(locked.name.text)) continue;
    preferred.set(locked.name.text, locked.version);
  }
  return preferred;
}

export async function resolveProject(
  project: Project,
  options: InstallOptions = {},
): Promise<Resolution> {
  const registry = options.registry ?? configuredRegistry(DEFAULT_REGISTRY, options.names);
  const provider = new ProjectProvider({
    root: project.root,
    manifest: project.manifest,
    fetcher: options.fetcher ?? new LocalSourceFetcher(options.names),
    includeDev: options.includeDev ?? true,
    registry,
    preferred: preferencesFrom(options.previous ?? null, options.refresh ?? null),
    ...(options.names === undefined ? {} : { names: options.names }),
  });
  await provider.prepare();

  const decisions = await solve({
    root: provider.rootName,
    rootVersion: provider.rootVersion,
    provider,
  });

  const store = registry === null ? null : new RegistryStore(registry, options.names);
  const packages = new Map<string, LockedPackage>();
  const contents: PackageContents[] = [];
  for (const [name, version] of decisions) {
    const packageName = parsePackageName(name, options.names);
    const resolved = await locate(provider, store, packageName, version);
    packages.set(name, {
      name: packageName,
      version,
      source: resolved.source,
      integrity: resolved.integrity,
      dependencies: dependencyNamesOf(resolved.manifest),
    });
    contents.push({
      name: packageName,
      version,
      source: resolved.source,
      directory: directoryOf(resolved.directory, resolved.manifest),
    });
  }

  contents.sort((left, right) => compareNames(left.name, right.name));
  return { lock: { root: project.manifest.name, packages }, contents };
}

type Located = {
  readonly directory: string;
  readonly manifest: Manifest;
  readonly source: ResolvedSource;
  readonly integrity: string | null;
};

async function locate(
  provider: ProjectProvider,
  store: RegistryStore | null,
  name: PackageName,
  version: Version,
): Promise<Located> {
  const checkout = provider.pinFor(name.text);
  if (checkout !== undefined) {
    return {
      directory: checkout.directory,
      manifest: checkout.manifest,
      source: checkout.source,
      integrity: null,
    };
  }
  const entry = await provider.entryFor(name.text, version);
  if (entry === undefined || store === null) {
    throw new InstallError(`resolved '${name.text}' has no source to install from`);
  }
  const stored = await store.materialize(name, version, entry);
  return {
    directory: stored.directory,
    manifest: stored.manifest,
    source: { kind: "registry", registry: provider.registryName ?? DEFAULT_REGISTRY },
    integrity: stored.integrity,
  };
}

function dependencyNamesOf(manifest: Manifest): readonly PackageName[] {
  return allDependencies(manifest, false)
    .map((dependency) => dependency.name)
    .sort(compareNames);
}

export async function install(
  project: Project,
  options: InstallOptions = {},
): Promise<InstallReport> {
  const previous = readLock(project, options.names) ?? emptyLock(project.manifest.name);
  const resolution = await resolveProject(project, { previous, ...options });
  const lockChanged = formatLock(previous) !== formatLock(resolution.lock);
  if (lockChanged && options.frozen === true) {
    throw new InstallError(
      "the lockfile is out of date with tera.json (run 'peta install' without --frozen)",
    );
  }
  const outcome = syncTree(project.root, resolution.contents);
  if (lockChanged) writeLock(project, resolution.lock);
  return { lock: resolution.lock, outcome, lockChanged };
}

export function versionsOf(lock: LockFile): ReadonlyMap<string, Version> {
  const versions = new Map<string, Version>();
  for (const locked of lock.packages.values()) versions.set(locked.name.text, locked.version);
  return versions;
}
