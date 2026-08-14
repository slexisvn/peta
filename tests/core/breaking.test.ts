import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { integrityOf, packArchive } from "../../src/core/archive.js";
import { compareWithPublished, verdictLines, type SurfaceReader } from "../../src/core/breaking.js";
import { InterfaceError, type ModuleSurface, type PackageSurface } from "../../src/core/interface-diff.js";
import { HOME_VARIABLE } from "../../src/core/home.js";
import { parsePackageName } from "../../src/core/name.js";
import { loadProject, readManifestAt } from "../../src/core/project.js";
import { parseRange } from "../../src/core/range.js";
import { formatVersion, parseVersion } from "../../src/core/version.js";
import {
  archivePathFor,
  formatPackageIndex,
  indexPathFor,
  parsePackageIndex,
} from "../../src/registry/index-file.js";
import { FileRegistry } from "../../src/registry/registry.js";
import { Sandbox, type PackageSpec } from "../support/project.js";

const NAME = "slexis.demo";

let box: Sandbox;
let previousHome: string | undefined;

beforeEach(() => {
  box = Sandbox.create("breaking");
  previousHome = process.env[HOME_VARIABLE];
  process.env[HOME_VARIABLE] = box.at("home");
});

afterEach(() => {
  if (previousHome === undefined) delete process.env[HOME_VARIABLE];
  else process.env[HOME_VARIABLE] = previousHome;
  box.remove();
});

function publish(version: string): void {
  const spec: PackageSpec = {
    name: NAME,
    version,
    files: { "src/__init__.tera": `version = "${version}"\n` },
  };
  const directory = box.package(`build/${version}`, spec);
  const archive = packArchive(directory, readManifestAt(directory));
  const location = archivePathFor(parsePackageName(NAME), parseVersion(version));
  box.writeBytes(`registry/${location}`, archive);

  const name = parsePackageName(NAME);
  const indexPath = `registry/${indexPathFor(name)}`;
  const existing = box.exists(indexPath) ? parsePackageIndex(box.read(indexPath)).entries : [];
  box.write(
    indexPath,
    formatPackageIndex({
      name,
      entries: [
        ...existing,
        {
          version: parseVersion(version),
          dependencies: [{ name: parsePackageName("slexis.json"), range: parseRange("^1.0.0") }],
          integrity: integrityOf(archive),
          archive: location,
          yanked: false,
        },
      ],
    }),
  );
}

function local(version: string): string {
  box.package("work", {
    name: NAME,
    version,
    files: { "src/__init__.tera": `version = "${version}"\n` },
  });
  return box.at("work");
}

function fetching(params: readonly { name: string; type: string }[]): ModuleSurface {
  return { builtins: [{ name: "fetch", params, returns: "string" }] };
}

const STABLE = fetching([{ name: "path", type: "string" }]);
const WIDER: ModuleSurface = {
  builtins: [...STABLE.builtins!, { name: "post", params: [], returns: "string" }],
};
const NARROWED = fetching([]);

const SURFACES: Record<string, PackageSurface> = {
  "1.0.0": new Map([["", STABLE]]),
  "1.0.1": new Map([["", STABLE]]),
  "1.1.0": new Map([["", WIDER]]),
  "1.1.1": new Map([["", NARROWED]]),
  "2.0.0": new Map([["", NARROWED]]),
};

const declaredSurfaces: SurfaceReader = (_root, manifest) => {
  const version = formatVersion(manifest.version!);
  const surface = SURFACES[version];
  if (surface === undefined) throw new Error(`no surface declared for ${version}`);
  return surface;
};

function registry(): FileRegistry {
  return new FileRegistry("test", box.at("registry"));
}

let toolingLoads = 0;

async function compare(version: string, baseline?: string) {
  return compareWithPublished(loadProject(local(version)), {
    registry: registry(),
    tooling: async () => {
      toolingLoads += 1;
      return { surfaceOf: declaredSurfaces, accepts: (actual, expected) => actual === expected };
    },
    ...(baseline === undefined ? {} : { baseline: parseVersion(baseline) }),
  });
}

describe("comparing against the published surface", () => {
  it("has nothing to compare before the first release, and never asks for the compiler", async () => {
    toolingLoads = 0;
    expect(await compare("1.0.0")).toBeNull();
    expect(toolingLoads).toBe(0);
  });

  it("accepts a patch release that changed nothing", async () => {
    publish("1.0.0");
    const report = (await compare("1.0.1"))!;

    expect(formatVersion(report.baseline)).toBe("1.0.0");
    expect(report.impact).toBe("compatible");
    expect(report.sufficient).toBe(true);
  });

  it("accepts a minor release that only adds an export", async () => {
    publish("1.0.0");
    const report = (await compare("1.1.0"))!;

    expect(report.impact).toBe("additive");
    expect(report.sufficient).toBe(true);
  });

  it("accepts a major release that drops a parameter", async () => {
    publish("1.0.0");
    const report = (await compare("2.0.0"))!;

    expect(report.impact).toBe("breaking");
    expect(report.sufficient).toBe(true);
    expect(report.changes.map((change) => change.symbol)).toContain("fetch");
  });

  it("compares against the highest version below the one being released", async () => {
    publish("1.0.0");
    publish("1.1.0");
    const report = (await compare("2.0.0"))!;

    expect(formatVersion(report.baseline)).toBe("1.1.0");
  });

  it("compares against a pinned baseline instead", async () => {
    publish("1.0.0");
    publish("1.1.0");
    const report = (await compare("2.0.0", "1.0.0"))!;

    expect(formatVersion(report.baseline)).toBe("1.0.0");
  });

  it("refuses a baseline the registry does not have", async () => {
    publish("1.0.0");
    await expect(compare("2.0.0", "0.9.0")).rejects.toBeInstanceOf(InterfaceError);
  });

  it("reports the required version when the release is too small", async () => {
    publish("1.1.0");
    const report = (await compare("1.1.1"))!;

    expect(report.impact).toBe("breaking");
    expect(report.sufficient).toBe(false);
    expect(formatVersion(report.required)).toBe("2.0.0");
    expect(verdictLines(report).at(-1)).toBe("a breaking change needs 2.0.0 or higher, not 1.1.1");
  });
});
