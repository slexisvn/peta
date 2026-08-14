import { describe, it, expect } from "vitest";
import {
  DEFAULT_MODULES,
  emptyManifest,
  formatManifest,
  parseManifest,
  withDependency,
  withoutDependency,
} from "../../src/core/manifest.js";
import { ManifestError } from "../../src/core/errors.js";
import { parsePackageName } from "../../src/core/name.js";
import { parseRange } from "../../src/core/range.js";
import {
  DEFAULT_REGISTRY,
  describeSource,
  type DependencySource,
} from "../../src/core/source.js";
import { formatVersion } from "../../src/core/version.js";

function registry(text: string): DependencySource {
  return { kind: "registry", registry: DEFAULT_REGISTRY, range: parseRange(text) };
}

const LIBRARY = JSON.stringify({
  name: "slexis.http",
  version: "0.3.1",
  description: "HTTP client for tera",
  license: "MIT",
  modules: "src",
  dependencies: { "slexis.json": "^1.2.0", "acme.urlparse": "~0.4.0" },
  tasks: { test: "tera run tests/all.tera" },
  include: ["src/**/*.tera"],
});

describe("parseManifest", () => {
  it("reads a library manifest", () => {
    const manifest = parseManifest(LIBRARY);
    expect(manifest.name?.text).toBe("slexis.http");
    expect(formatVersion(manifest.version!)).toBe("0.3.1");
    expect(manifest.description).toBe("HTTP client for tera");
    expect(manifest.tasks.get("test")).toBe("tera run tests/all.tera");
    expect(manifest.include).toEqual(["src/**/*.tera"]);
  });

  it("sorts dependencies by name so the file order cannot drift", () => {
    const manifest = parseManifest(LIBRARY);
    expect(manifest.dependencies.map((entry) => entry.name.text)).toEqual([
      "acme.urlparse",
      "slexis.json",
    ]);
  });

  it("defaults the module directory", () => {
    expect(parseManifest("{}").modules).toBe(DEFAULT_MODULES);
  });

  it("accepts an unnamed application manifest", () => {
    const manifest = parseManifest(JSON.stringify({ dependencies: { "slexis.http": "^0.3.0" } }));
    expect(manifest.name).toBeNull();
    expect(manifest.version).toBeNull();
    expect(manifest.dependencies).toHaveLength(1);
  });

  it("requires name and version together", () => {
    expect(() => parseManifest(JSON.stringify({ name: "slexis.http" }))).toThrow(ManifestError);
    expect(() => parseManifest(JSON.stringify({ version: "1.0.0" }))).toThrow(ManifestError);
  });

  it("rejects unknown fields", () => {
    expect(() => parseManifest(JSON.stringify({ main: "src/index.tera" }))).toThrow(/unknown field/);
  });

  it("reports the offending dependency by path", () => {
    const text = JSON.stringify({ dependencies: { "slexis.json": "not-a-range" } });
    expect(() => parseManifest(text)).toThrow(/dependencies\.slexis\.json/);
  });

  it("rejects a module directory that escapes the package", () => {
    expect(() => parseManifest(JSON.stringify({ modules: "../src" }))).toThrow(/escape/);
    expect(() => parseManifest(JSON.stringify({ modules: "/abs" }))).toThrow(/relative/);
  });

  it("rejects malformed json with a manifest error", () => {
    expect(() => parseManifest("{")).toThrow(ManifestError);
  });
});

describe("formatManifest", () => {
  it("round-trips a library manifest", () => {
    const manifest = parseManifest(LIBRARY);
    const reparsed = parseManifest(formatManifest(manifest));
    expect(formatManifest(reparsed)).toBe(formatManifest(manifest));
  });

  it("emits a trailing newline and stable key order", () => {
    const text = formatManifest(parseManifest(LIBRARY));
    expect(text.endsWith("\n")).toBe(true);
    expect(Object.keys(JSON.parse(text) as object)).toEqual([
      "name",
      "version",
      "description",
      "license",
      "modules",
      "dependencies",
      "tasks",
      "include",
    ]);
  });

  it("keeps an application manifest free of identity fields", () => {
    const text = formatManifest(emptyManifest());
    expect(JSON.parse(text)).toEqual({ modules: DEFAULT_MODULES, dependencies: {} });
  });
});

describe("dependency edits", () => {
  const dependency = {
    name: parsePackageName("slexis.json"),
    source: registry("^1.0.0"),
  };

  it("adds and replaces by name", () => {
    const once = withDependency(emptyManifest(), "dependencies", dependency);
    const twice = withDependency(once, "dependencies", {
      name: dependency.name,
      source: registry("^2.0.0"),
    });
    expect(twice.dependencies).toHaveLength(1);
    expect(describeSource(twice.dependencies[0]!.source)).toBe("^2.0.0");
  });

  it("keeps the list sorted", () => {
    const manifest = [
      { name: parsePackageName("zeta.one"), source: registry("^1.0.0") },
      { name: parsePackageName("alpha.two"), source: registry("^1.0.0") },
    ].reduce((current, entry) => withDependency(current, "dependencies", entry), emptyManifest());
    expect(manifest.dependencies.map((entry) => entry.name.text)).toEqual([
      "alpha.two",
      "zeta.one",
    ]);
  });

  it("removes from both dependency kinds", () => {
    const manifest = withDependency(emptyManifest(), "devDependencies", dependency);
    expect(withoutDependency(manifest, dependency.name).devDependencies).toHaveLength(0);
  });
});
