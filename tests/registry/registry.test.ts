import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { run } from "../../src/cli/run.js";
import { HOME_VARIABLE } from "../../src/core/home.js";
import { REGISTRY_VARIABLE, FileRegistry, HttpRegistry } from "../../src/registry/registry.js";
import {
  archivePathFor,
  formatPackageIndex,
  indexPathFor,
  parsePackageIndex,
  selectableEntries,
} from "../../src/registry/index-file.js";
import { integrityOf, packArchive } from "../../src/core/archive.js";
import { readManifestAt } from "../../src/core/project.js";
import { parsePackageName } from "../../src/core/name.js";
import { parseRange } from "../../src/core/range.js";
import { parseVersion } from "../../src/core/version.js";
import { Sandbox, type PackageSpec } from "../support/project.js";

let box: Sandbox;
let output: string[];
let previousHome: string | undefined;
let previousRegistry: string | undefined;

function publish(spec: PackageSpec & { name: string; version: string }): void {
  const source = `build/${spec.name}-${spec.version}`;
  const directory = box.package(source, spec);
  const archive = packArchive(directory, readManifestAt(directory));
  const location = archivePathFor(parsePackageName(spec.name), parseVersion(spec.version));
  box.writeBytes(`registry/${location}`, archive);

  const name = parsePackageName(spec.name);
  const indexPath = `registry/${indexPathFor(name)}`;
  const existing = box.exists(indexPath)
    ? parsePackageIndex(box.read(indexPath)).entries
    : [];
  box.write(
    indexPath,
    formatPackageIndex({
      name,
      entries: [
        ...existing,
        {
          version: parseVersion(spec.version),
          dependencies: Object.entries(spec.dependencies ?? {}).map(([key, range]) => ({
            name: parsePackageName(key),
            range: parseRange(String(range)),
          })),
          integrity: integrityOf(archive),
          archive: location,
          yanked: false,
        },
      ],
    }),
  );
}

beforeEach(() => {
  box = Sandbox.create("registry");
  output = [];
  previousHome = process.env[HOME_VARIABLE];
  previousRegistry = process.env[REGISTRY_VARIABLE];
  process.env[HOME_VARIABLE] = box.at("home");
  process.env[REGISTRY_VARIABLE] = box.at("registry");
  vi.spyOn(console, "log").mockImplementation((text: unknown) => {
    output.push(String(text));
  });
  vi.spyOn(console, "error").mockImplementation((text: unknown) => {
    output.push(String(text));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const [key, value] of [
    [HOME_VARIABLE, previousHome],
    [REGISTRY_VARIABLE, previousRegistry],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  box.remove();
});

describe("the package index format", () => {
  const source = JSON.stringify({
    name: "slexis.http",
    versions: [
      {
        version: "0.3.1",
        dependencies: { "slexis.json": "^1.2.0" },
        integrity: "sha256-abc",
        archive: "pkg/slexis.http/0.3.1.tpkg",
      },
      { version: "0.2.0", integrity: "sha256-def", archive: "pkg/slexis.http/0.2.0.tpkg", yanked: true },
    ],
  });

  it("sorts versions ascending and keeps yanked ones", () => {
    const index = parsePackageIndex(source);
    expect(index.entries.map((entry) => entry.version.minor)).toEqual([2, 3]);
    expect(index.entries[0]!.yanked).toBe(true);
  });

  it("hides yanked versions from selection", () => {
    expect(selectableEntries(parsePackageIndex(source))).toHaveLength(1);
  });

  it("round-trips", () => {
    const once = formatPackageIndex(parsePackageIndex(source));
    expect(formatPackageIndex(parsePackageIndex(once))).toBe(once);
  });

  it("rejects a duplicate version", () => {
    const duplicate = JSON.stringify({
      name: "slexis.http",
      versions: [
        { version: "1.0.0", integrity: "a", archive: "b" },
        { version: "1.0.0", integrity: "c", archive: "d" },
      ],
    });
    expect(() => parsePackageIndex(duplicate)).toThrow(/duplicate version/);
  });

  it("derives the index path from the dotted name", () => {
    expect(indexPathFor(parsePackageName("slexis.http"))).toBe("index/slexis/http.json");
  });
});

describe("peta install from a file registry", () => {
  it("resolves a range, downloads, verifies and installs", async () => {
    publish({ name: "slexis.json", version: "1.0.0" });
    publish({ name: "slexis.json", version: "1.4.0" });
    publish({ name: "slexis.json", version: "2.0.0" });
    box.package("app", { dependencies: { "slexis.json": "^1.0.0" } });

    expect(await run(["install", "-C", box.at("app")])).toBe(0);
    expect(box.exists("app/tera_packages/slexis/json/__init__.tera")).toBe(true);

    const lock = JSON.parse(box.read("app/tera.lock")) as {
      packages: Record<string, { version: string; source: string; integrity: string }>;
    };
    expect(lock.packages["slexis.json"]!.version).toBe("1.4.0");
    expect(lock.packages["slexis.json"]!.source).toBe("petahub");
    expect(lock.packages["slexis.json"]!.integrity.startsWith("sha256-")).toBe(true);
  });

  it("installs a registry package's own dependencies", async () => {
    publish({ name: "slexis.core", version: "0.5.0" });
    publish({
      name: "slexis.json",
      version: "1.0.0",
      dependencies: { "slexis.core": "^0.5.0" },
    });
    box.package("app", { dependencies: { "slexis.json": "^1.0.0" } });

    expect(await run(["install", "-C", box.at("app")])).toBe(0);
    expect(box.list("app/tera_packages/slexis")).toEqual(["core", "json"]);
  });

  it("refuses an archive whose bytes do not match the index", async () => {
    publish({ name: "slexis.json", version: "1.0.0" });
    box.write("registry/pkg/slexis.json/1.0.0.tpkg", "tampered");
    box.package("app", { dependencies: { "slexis.json": "^1.0.0" } });

    expect(await run(["install", "-C", box.at("app")])).toBe(1);
    expect(output.join("\n")).toContain("integrity check");
  });

  it("never selects a yanked version", async () => {
    publish({ name: "slexis.json", version: "1.0.0" });
    publish({ name: "slexis.json", version: "1.5.0" });
    const indexPath = `registry/${indexPathFor(parsePackageName("slexis.json"))}`;
    const index = parsePackageIndex(box.read(indexPath));
    box.write(
      indexPath,
      formatPackageIndex({
        name: index.name,
        entries: index.entries.map((entry) =>
          entry.version.minor === 5 ? { ...entry, yanked: true } : entry,
        ),
      }),
    );
    box.package("app", { dependencies: { "slexis.json": "^1.0.0" } });

    expect(await run(["install", "-C", box.at("app")])).toBe(0);
    const lock = JSON.parse(box.read("app/tera.lock")) as {
      packages: Record<string, { version: string }>;
    };
    expect(lock.packages["slexis.json"]!.version).toBe("1.0.0");
  });

  it("explains a range the registry cannot satisfy", async () => {
    publish({ name: "slexis.json", version: "1.0.0" });
    box.package("app", { dependencies: { "slexis.json": "^2.0.0" } });

    expect(await run(["install", "-C", box.at("app")])).toBe(1);
    expect(output.join("\n")).toContain("no versions of slexis.json match >=2.0.0 <3.0.0");
  });

  it("lets a path dependency override the registry", async () => {
    publish({ name: "slexis.json", version: "1.0.0" });
    box.package("local", {
      name: "slexis.json",
      version: "1.9.9",
      files: { "src/__init__.tera": "local\n" },
    });
    box.package("app", { dependencies: { "slexis.json": { path: "../local" } } });

    expect(await run(["install", "-C", box.at("app")])).toBe(0);
    expect(box.read("app/tera_packages/slexis/json/__init__.tera")).toBe("local\n");
  });
});

describe("the lockfile pins what install picks", () => {
  async function lockedVersion(): Promise<string> {
    const lock = JSON.parse(box.read("app/tera.lock")) as {
      packages: Record<string, { version: string }>;
    };
    return lock.packages["slexis.json"]!.version;
  }

  it("keeps the locked version when a newer one appears", async () => {
    publish({ name: "slexis.json", version: "1.0.0" });
    box.package("app", { dependencies: { "slexis.json": "^1.0.0" } });
    await run(["install", "-C", box.at("app")]);
    expect(await lockedVersion()).toBe("1.0.0");

    publish({ name: "slexis.json", version: "1.5.0" });
    expect(await run(["install", "-C", box.at("app")])).toBe(0);
    expect(await lockedVersion()).toBe("1.0.0");
  });

  it("moves to the newest allowed version on update", async () => {
    publish({ name: "slexis.json", version: "1.0.0" });
    box.package("app", { dependencies: { "slexis.json": "^1.0.0" } });
    await run(["install", "-C", box.at("app")]);
    publish({ name: "slexis.json", version: "1.5.0" });
    publish({ name: "slexis.json", version: "2.0.0" });
    output.length = 0;

    expect(await run(["update", "-C", box.at("app")])).toBe(0);
    expect(await lockedVersion()).toBe("1.5.0");
    expect(output.join("\n")).toContain("slexis.json 1.0.0 -> 1.5.0");
  });

  it("updates only the named package", async () => {
    publish({ name: "slexis.json", version: "1.0.0" });
    publish({ name: "acme.http", version: "1.0.0" });
    box.package("app", {
      dependencies: { "slexis.json": "^1.0.0", "acme.http": "^1.0.0" },
    });
    await run(["install", "-C", box.at("app")]);
    publish({ name: "slexis.json", version: "1.5.0" });
    publish({ name: "acme.http", version: "1.5.0" });

    expect(await run(["update", "slexis.json", "-C", box.at("app")])).toBe(0);
    const lock = JSON.parse(box.read("app/tera.lock")) as {
      packages: Record<string, { version: string }>;
    };
    expect(lock.packages["slexis.json"]!.version).toBe("1.5.0");
    expect(lock.packages["acme.http"]!.version).toBe("1.0.0");
  });

  it("reports when nothing can move", async () => {
    publish({ name: "slexis.json", version: "1.0.0" });
    box.package("app", { dependencies: { "slexis.json": "^1.0.0" } });
    await run(["install", "-C", box.at("app")]);
    output.length = 0;

    expect(await run(["update", "-C", box.at("app")])).toBe(0);
    expect(output.join("\n")).toContain("already at the newest allowed version");
  });

  it("refuses to update something that is not a dependency", async () => {
    box.package("app", {});
    expect(await run(["update", "slexis.json", "-C", box.at("app")])).toBe(2);
  });
});

describe("peta pack refuses unpublishable packages", () => {
  it("rejects a path dependency", async () => {
    box.package("lib", {
      name: "slexis.http",
      version: "0.1.0",
      dependencies: { "slexis.json": { path: "../json" } },
    });
    expect(await run(["pack", "-C", box.at("lib")])).toBe(2);
    expect(output.join("\n")).toContain("cannot depend on a path or git source");
  });
});

describe("peta search", () => {
  it("lists the registry's packages with their latest version", async () => {
    publish({ name: "slexis.json", version: "1.0.0" });
    publish({ name: "slexis.json", version: "1.4.0" });
    publish({ name: "acme.http", version: "0.1.0" });

    expect(await run(["search"])).toBe(0);
    expect(output).toEqual(["acme.http 0.1.0", "slexis.json 1.4.0"]);
  });

  it("filters by the query", async () => {
    publish({ name: "slexis.json", version: "1.0.0" });
    publish({ name: "acme.http", version: "0.1.0" });

    expect(await run(["search", "acme"])).toBe(0);
    expect(output).toEqual(["acme.http 0.1.0"]);
  });
});

describe("the http registry", () => {
  it("reads an index and an archive over http", async () => {
    publish({ name: "slexis.json", version: "1.0.0" });
    const fs = await import("node:fs");
    const path = await import("node:path");
    const server = http.createServer((request, response) => {
      const target = path.join(box.at("registry"), ...(request.url ?? "/").slice(1).split("/"));
      if (!fs.existsSync(target)) {
        response.statusCode = 404;
        response.end();
        return;
      }
      response.statusCode = 200;
      response.end(fs.readFileSync(target));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      const registry = new HttpRegistry("petahub", `http://127.0.0.1:${port}/`);
      const index = await registry.index(parsePackageName("slexis.json"));
      expect(index?.entries).toHaveLength(1);
      const archive = await registry.archive(index!.entries[0]!.archive);
      expect(integrityOf(archive)).toBe(index!.entries[0]!.integrity);
      expect(await registry.index(parsePackageName("acme.missing"))).toBeNull();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("the file registry", () => {
  it("returns null for an unknown package", async () => {
    const registry = new FileRegistry("petahub", box.at("registry"));
    expect(await registry.index(parsePackageName("acme.missing"))).toBeNull();
  });
});
