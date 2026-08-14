import fs from "node:fs";
import path from "node:path";
import { PetaError } from "./errors.js";
import { LOCK_FILE, PACKAGES_DIRECTORY, STATE_DIRECTORY } from "./layout.js";
import { emptyLock, formatLock, parseLock, type LockFile } from "./lock.js";
import {
  MANIFEST_FILE,
  formatManifest,
  parseManifest,
  type Manifest,
  type ManifestOptions,
} from "./manifest.js";

export class ProjectError extends PetaError {}

export type Project = {
  readonly root: string;
  readonly manifest: Manifest;
};

export function manifestPathIn(root: string): string {
  return path.join(root, MANIFEST_FILE);
}

export function lockPathIn(root: string): string {
  return path.join(root, LOCK_FILE);
}

export function packagesPathIn(root: string): string {
  return path.join(root, PACKAGES_DIRECTORY);
}

export function statePathIn(root: string): string {
  return path.join(packagesPathIn(root), STATE_DIRECTORY, "state.json");
}

export function findProjectRoot(start: string): string | null {
  let directory = path.resolve(start);
  for (;;) {
    if (fs.existsSync(manifestPathIn(directory))) return directory;
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

export function readManifestAt(root: string, options: ManifestOptions = {}): Manifest {
  const target = manifestPathIn(root);
  if (!fs.existsSync(target)) {
    throw new ProjectError(`no ${MANIFEST_FILE} in ${root}`);
  }
  return parseManifest(fs.readFileSync(target, "utf8"), options);
}

export function loadProject(start: string, options: ManifestOptions = {}): Project {
  const root = findProjectRoot(start);
  if (root === null) {
    throw new ProjectError(
      `no ${MANIFEST_FILE} found in ${path.resolve(start)} or any parent directory (run 'peta init')`,
    );
  }
  return { root, manifest: readManifestAt(root, options) };
}

export function readLock(project: Project, options: ManifestOptions = {}): LockFile | null {
  const target = lockPathIn(project.root);
  if (!fs.existsSync(target)) return null;
  return parseLock(fs.readFileSync(target, "utf8"), options);
}

export function writeLock(project: Project, lock: LockFile): void {
  fs.writeFileSync(lockPathIn(project.root), formatLock(lock), "utf8");
}

export function writeManifest(project: Project, manifest: Manifest): Project {
  fs.writeFileSync(manifestPathIn(project.root), formatManifest(manifest), "utf8");
  return { root: project.root, manifest };
}
