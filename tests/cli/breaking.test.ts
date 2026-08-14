import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { integrityOf, packArchive } from "../../src/core/archive.js";
import { HOME_VARIABLE } from "../../src/core/home.js";
import { parsePackageName } from "../../src/core/name.js";
import { readManifestAt } from "../../src/core/project.js";
import { parseVersion } from "../../src/core/version.js";
import { run } from "../../src/cli/run.js";
import { TERA_FRONTEND } from "../../src/core/surface.js";
import {
  archivePathFor,
  formatPackageIndex,
  indexPathFor,
} from "../../src/registry/index-file.js";
import { REGISTRY_VARIABLE } from "../../src/registry/registry.js";
import { Sandbox } from "../support/project.js";

const NAME = "slexis.demo";

function compilerInstalled(): boolean {
  try {
    createRequire(import.meta.url).resolve(TERA_FRONTEND);
    return true;
  } catch {
    return false;
  }
}

const withoutCompiler = it.skipIf(compilerInstalled());

let box: Sandbox;
let output: string[];
let previousHome: string | undefined;
let previousRegistry: string | undefined;

beforeEach(() => {
  box = Sandbox.create("breaking-cli");
  output = [];
  previousHome = process.env[HOME_VARIABLE];
  previousRegistry = process.env[REGISTRY_VARIABLE];
  process.env[HOME_VARIABLE] = box.at("home");
  process.env[REGISTRY_VARIABLE] = box.at("registry");
  vi.spyOn(console, "log").mockImplementation((text: unknown) => void output.push(String(text)));
  vi.spyOn(console, "error").mockImplementation((text: unknown) => void output.push(String(text)));
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

function project(version: string): string {
  box.package("work", {
    name: NAME,
    version,
    files: { "src/__init__.tera": "fn greet() -> string:\n  return \"hi\"\n" },
  });
  return box.at("work");
}

function publish(version: string): void {
  const directory = box.package(`build/${version}`, {
    name: NAME,
    version,
    files: { "src/__init__.tera": "fn greet() -> string:\n  return \"hi\"\n" },
  });
  const archive = packArchive(directory, readManifestAt(directory));
  const name = parsePackageName(NAME);
  const location = archivePathFor(name, parseVersion(version));
  box.writeBytes(`registry/${location}`, archive);
  box.write(
    `registry/${indexPathFor(name)}`,
    formatPackageIndex({
      name,
      entries: [
        {
          version: parseVersion(version),
          dependencies: [],
          integrity: integrityOf(archive),
          archive: location,
          yanked: false,
        },
      ],
    }),
  );
}

describe("peta check --breaking", () => {
  it("says there is nothing to compare before the first release", async () => {
    expect(await run(["check", "--breaking", "-C", project("1.0.0")])).toBe(0);
    expect(output.join("\n")).toContain("nothing to compare");
  });

  it("leaves the surface alone unless it is asked", async () => {
    publish("1.0.0");
    expect(await run(["check", "-C", project("1.0.1")])).toBe(0);
    expect(output.join("\n")).not.toContain("surface");
  });

  withoutCompiler("explains that the comparison needs the compiler", async () => {
    publish("1.0.0");
    const status = await run(["check", "--breaking", "-C", project("1.0.1")]);

    expect(status).toBe(1);
    expect(output.join("\n")).toContain("@slexisvn/tera");
  });

  withoutCompiler("takes --baseline as an implicit --breaking", async () => {
    publish("1.0.0");
    await run(["check", "--baseline", "1.0.0", "-C", project("1.0.1")]);

    expect(output.join("\n")).toContain("@slexisvn/tera");
  });
});

describe("peta publish", () => {
  it("packs a first release without a surface to compare", async () => {
    expect(await run(["publish", "--dry-run", "-C", project("1.0.0")])).toBe(0);
    expect(output.join("\n")).toContain("dry run: nothing was uploaded");
  });

  withoutCompiler("reports a skipped semver check instead of refusing to publish", async () => {
    publish("1.0.0");
    const status = await run(["publish", "--dry-run", "-C", project("1.0.1")]);

    expect(status).toBe(0);
    expect(output.join("\n")).toContain("the semver check was skipped");
  });
});
