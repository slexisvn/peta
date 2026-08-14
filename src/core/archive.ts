import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { ContentError, isUnsafePath, requireAllowed } from "./content.js";
import { PetaError } from "./errors.js";
import { Glob } from "./glob.js";
import { MANIFEST_FILE, parseManifest, type Manifest, type ManifestOptions } from "./manifest.js";
import { packTar, unpackTar, type TarEntry } from "./tar.js";
import { formatVersion } from "./version.js";

export class ArchiveError extends PetaError {}

export const ARCHIVE_EXTENSION = ".tpkg";
export const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
export const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
export const MAX_ENTRIES = 4096;

const METADATA_FILES: ReadonlySet<string> = new Set([MANIFEST_FILE, "README.md", "LICENSE"]);

export type ArchiveContents = {
  readonly manifest: Manifest;
  readonly entries: readonly TarEntry[];
};

export function archiveNameFor(manifest: Manifest): string {
  if (manifest.name === null || manifest.version === null) {
    throw new ArchiveError(`a package needs a name and a version in its ${MANIFEST_FILE} to pack`);
  }
  return `${manifest.name.text}-${formatVersion(manifest.version)}${ARCHIVE_EXTENSION}`;
}

export function integrityOf(archive: Buffer): string {
  return `sha256-${crypto.createHash("sha256").update(archive).digest("base64")}`;
}

function assertEntryPath(target: string): void {
  if (isUnsafePath(target)) throw new ContentError(`'${target}' escapes the package root`);
  if (METADATA_FILES.has(target)) return;
  requireAllowed(target);
}

function collect(directory: string, prefix: string, into: TarEntry[]): void {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new ContentError(`'${relative}' is a symbolic link, which a package may not contain`);
    }
    if (entry.isDirectory()) {
      collect(target, relative, into);
      continue;
    }
    if (!entry.isFile()) continue;
    assertEntryPath(relative);
    const contents = fs.readFileSync(target);
    if (contents.length > MAX_ENTRY_BYTES) {
      throw new ArchiveError(`'${relative}' is larger than the ${MAX_ENTRY_BYTES} byte entry limit`);
    }
    into.push({ path: relative, contents });
  }
}

export function packageEntries(root: string, manifest: Manifest): readonly TarEntry[] {
  const collected: TarEntry[] = [];
  collect(path.join(root, manifest.modules), manifest.modules, collected);
  const include = new Glob(manifest.include);
  const entries = collected.filter((entry) => include.matches(entry.path));
  if (entries.length === 0) {
    throw new ArchiveError(
      manifest.include.length === 0
        ? `${manifest.modules}/ holds no files to publish`
        : `no file under ${manifest.modules}/ matches 'include'`,
    );
  }
  for (const file of METADATA_FILES) {
    const target = path.join(root, file);
    if (fs.existsSync(target) && fs.statSync(target).isFile()) {
      entries.push({ path: file, contents: fs.readFileSync(target) });
    }
  }
  if (entries.length > MAX_ENTRIES) {
    throw new ArchiveError(`a package may hold at most ${MAX_ENTRIES} files`);
  }
  return entries;
}

export function packArchive(root: string, manifest: Manifest): Buffer {
  const archive = zlib.gzipSync(packTar(packageEntries(root, manifest)), { level: 9 });
  if (archive.length > MAX_ARCHIVE_BYTES) {
    throw new ArchiveError(`the archive exceeds the ${MAX_ARCHIVE_BYTES} byte limit`);
  }
  return archive;
}

export function readArchive(archive: Buffer, options: ManifestOptions = {}): ArchiveContents {
  if (archive.length > MAX_ARCHIVE_BYTES) {
    throw new ArchiveError(`the archive exceeds the ${MAX_ARCHIVE_BYTES} byte limit`);
  }
  const entries = unpackTar(zlib.gunzipSync(archive));
  if (entries.length > MAX_ENTRIES) {
    throw new ArchiveError(`the archive holds more than ${MAX_ENTRIES} files`);
  }
  for (const entry of entries) {
    assertEntryPath(entry.path);
    if (entry.contents.length > MAX_ENTRY_BYTES) {
      throw new ArchiveError(`'${entry.path}' is larger than the ${MAX_ENTRY_BYTES} byte limit`);
    }
  }
  const manifestEntry = entries.find((entry) => entry.path === MANIFEST_FILE);
  if (manifestEntry === undefined) {
    throw new ArchiveError(`the archive has no ${MANIFEST_FILE}`);
  }
  return {
    manifest: parseManifest(manifestEntry.contents.toString("utf8"), options),
    entries,
  };
}

export function extractArchive(archive: Buffer, target: string, options: ManifestOptions = {}): Manifest {
  const contents = readArchive(archive, options);
  fs.rmSync(target, { recursive: true, force: true });
  for (const entry of contents.entries) {
    const destination = path.join(target, ...entry.path.split("/"));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, entry.contents);
  }
  return contents.manifest;
}
