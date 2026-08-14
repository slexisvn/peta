import fs from "node:fs";
import path from "node:path";
import { extractArchive } from "../core/archive.js";
import { archiveCacheDirectory, cacheDirectory } from "../core/home.js";
import type { ManifestOptions, Manifest } from "../core/manifest.js";
import type { PackageName } from "../core/name.js";
import { readManifestAt } from "../core/project.js";
import { formatVersion, type Version } from "../core/version.js";
import type { IndexEntry } from "./index-file.js";
import { verifyIntegrity, type Registry } from "./registry.js";

export type StoredPackage = {
  readonly directory: string;
  readonly manifest: Manifest;
  readonly integrity: string;
};

const MARKER = ".peta-integrity";

function safeSegment(text: string): string {
  return text.replace(/[^A-Za-z0-9._-]/g, "_");
}

export class RegistryStore {
  constructor(
    private readonly registry: Registry,
    private readonly options: ManifestOptions = {},
  ) {}

  directoryFor(name: PackageName, version: Version): string {
    return path.join(
      cacheDirectory(),
      "pkg",
      safeSegment(this.registry.name),
      safeSegment(name.text),
      safeSegment(formatVersion(version)),
    );
  }

  private archivePathFor(name: PackageName, version: Version): string {
    return path.join(
      archiveCacheDirectory(),
      safeSegment(this.registry.name),
      `${safeSegment(name.text)}-${safeSegment(formatVersion(version))}.tpkg`,
    );
  }

  private async download(name: PackageName, version: Version, entry: IndexEntry): Promise<Buffer> {
    const cached = this.archivePathFor(name, version);
    if (fs.existsSync(cached)) {
      const archive = fs.readFileSync(cached);
      try {
        verifyIntegrity(archive, entry.integrity, `${name.text} ${formatVersion(version)}`);
        return archive;
      } catch {
        fs.rmSync(cached, { force: true });
      }
    }
    const archive = await this.registry.archive(entry.archive);
    verifyIntegrity(archive, entry.integrity, `${name.text} ${formatVersion(version)}`);
    fs.mkdirSync(path.dirname(cached), { recursive: true });
    fs.writeFileSync(cached, archive);
    return archive;
  }

  async materialize(
    name: PackageName,
    version: Version,
    entry: IndexEntry,
  ): Promise<StoredPackage> {
    const directory = this.directoryFor(name, version);
    const marker = path.join(directory, MARKER);
    if (fs.existsSync(marker) && fs.readFileSync(marker, "utf8").trim() === entry.integrity) {
      return {
        directory,
        manifest: readManifestAt(directory, this.options),
        integrity: entry.integrity,
      };
    }
    const archive = await this.download(name, version, entry);
    const manifest = extractArchive(archive, directory, this.options);
    fs.writeFileSync(marker, `${entry.integrity}\n`, "utf8");
    return { directory, manifest, integrity: entry.integrity };
  }
}
