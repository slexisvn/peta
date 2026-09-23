import fs from "node:fs";
import https from "node:https";
import http from "node:http";
import path from "node:path";
import { integrityOf } from "../core/archive.js";
import { PetaError } from "../core/errors.js";
import { parsePackageName, type NameOptions, type PackageName } from "../core/name.js";
import { formatVersion } from "../core/version.js";
import {
  INDEX_DIRECTORY,
  indexPathFor,
  parsePackageIndex,
  selectableEntries,
  type PackageIndex,
} from "./index-file.js";
import { configuredRegistry as savedRegistry } from "./config.js";

export class RegistryError extends PetaError {}

export type SearchHit = {
  readonly name: string;
  readonly version: string | null;
  readonly description: string | null;
};

export interface Registry {
  readonly name: string;
  index(name: PackageName): Promise<PackageIndex | null>;
  archive(location: string): Promise<Buffer>;
  search(query: string): Promise<readonly SearchHit[]>;
}

export function verifyIntegrity(archive: Buffer, expected: string, label: string): void {
  const actual = integrityOf(archive);
  if (actual !== expected) {
    throw new RegistryError(
      `${label} failed its integrity check (expected ${expected}, got ${actual})`,
    );
  }
}

export class FileRegistry implements Registry {
  constructor(
    readonly name: string,
    private readonly root: string,
    private readonly options: NameOptions = {},
  ) {}

  async index(name: PackageName): Promise<PackageIndex | null> {
    const target = path.join(this.root, ...indexPathFor(name).split("/"));
    if (!fs.existsSync(target)) return null;
    return parsePackageIndex(fs.readFileSync(target, "utf8"), this.options);
  }

  async archive(location: string): Promise<Buffer> {
    const target = path.join(this.root, ...location.split("/"));
    if (!fs.existsSync(target)) {
      throw new RegistryError(`the registry has no archive at '${location}'`);
    }
    return fs.readFileSync(target);
  }

  async search(query: string): Promise<readonly SearchHit[]> {
    const root = path.join(this.root, INDEX_DIRECTORY);
    const found: string[] = [];
    const walk = (directory: string, prefix: readonly string[]): void => {
      if (!fs.existsSync(directory)) return;
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          walk(path.join(directory, entry.name), [...prefix, entry.name]);
          continue;
        }
        if (!entry.name.endsWith(".json")) continue;
        found.push([...prefix, entry.name.slice(0, -".json".length)].join("."));
      }
    };
    walk(root, []);
    const hits: SearchHit[] = [];
    for (const name of found.sort()) {
      if (!name.includes(query)) continue;
      const index = await this.index(parsePackageName(name, this.options));
      const selectable = index === null ? [] : selectableEntries(index);
      const latest = selectable[selectable.length - 1];
      hits.push({
        name,
        version: latest === undefined ? null : formatVersion(latest.version),
        description: null,
      });
    }
    return hits;
  }
}

const REDIRECT_LIMIT = 5;

function get(target: string, redirects = 0): Promise<{ status: number; body: Buffer }> {
  const url = new URL(target);
  const client = url.protocol === "http:" ? http : https;
  return new Promise((resolve, reject) => {
    const request = client.get(url, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location !== undefined) {
        response.resume();
        if (redirects >= REDIRECT_LIMIT) {
          reject(new RegistryError(`too many redirects for ${target}`));
          return;
        }
        get(new URL(location, url).toString(), redirects + 1).then(resolve, reject);
        return;
      }
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({ status, body: Buffer.concat(chunks) }));
    });
    request.on("error", (error) => reject(new RegistryError(`${target}: ${error.message}`)));
  });
}

export class HttpRegistry implements Registry {
  constructor(
    readonly name: string,
    private readonly base: string,
    private readonly options: NameOptions = {},
  ) {}

  private urlFor(location: string): string {
    return new URL(location, this.base.endsWith("/") ? this.base : `${this.base}/`).toString();
  }

  async index(name: PackageName): Promise<PackageIndex | null> {
    const target = this.urlFor(indexPathFor(name));
    const response = await get(target);
    if (response.status === 404) return null;
    if (response.status !== 200) {
      throw new RegistryError(`${target} returned ${response.status}`);
    }
    return parsePackageIndex(response.body.toString("utf8"), this.options);
  }

  async archive(location: string): Promise<Buffer> {
    const target = this.urlFor(location);
    const response = await get(target);
    if (response.status !== 200) {
      throw new RegistryError(`${target} returned ${response.status}`);
    }
    return response.body;
  }

  async search(query: string): Promise<readonly SearchHit[]> {
    const target = this.urlFor(
      query.length === 0 ? "api/v1/packages" : `api/v1/packages?q=${encodeURIComponent(query)}`,
    );
    const response = await get(target);
    if (response.status !== 200) throw new RegistryError(`${target} returned ${response.status}`);
    const body = JSON.parse(response.body.toString("utf8")) as {
      packages?: { name: string; latest: string | null; description: string | null }[];
    };
    return (body.packages ?? []).map((entry) => ({
      name: entry.name,
      version: entry.latest,
      description: entry.description,
    }));
  }
}

export const REGISTRY_VARIABLE = "PETA_REGISTRY";

function isBareHost(location: string): boolean {
  return /^(localhost|[a-z0-9][a-z0-9.-]*\.[a-z0-9.-]+)(:\d+)?(\/.*)?$/i.test(location);
}

export function normalizeRegistryLocation(location: string): string {
  const trimmed = location.trim();
  const normalized = trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
  if (/^https?:\/\//.test(normalized)) return normalized;
  if (isBareHost(normalized)) return `https://${normalized}`;
  return normalized;
}

export function registryFrom(
  location: string,
  name: string,
  options: NameOptions = {},
): Registry {
  const normalized = normalizeRegistryLocation(location);
  if (/^https?:\/\//.test(normalized)) return new HttpRegistry(name, normalized, options);
  return new FileRegistry(name, path.resolve(normalized), options);
}

export function configuredRegistryLocation(override: string | null = null): string | null {
  const env = process.env[REGISTRY_VARIABLE];
  const location = override ?? (env !== undefined && env.length > 0 ? env : savedRegistry());
  return location === null ? null : normalizeRegistryLocation(location);
}

export function configuredRegistry(name: string, options: NameOptions = {}): Registry | null {
  const location = configuredRegistryLocation();
  return location === null ? null : registryFrom(location, name, options);
}
