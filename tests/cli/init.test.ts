import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "../../src/cli/run.js";
import { MANIFEST_FILE, parseManifest } from "../../src/core/manifest.js";
import { PACKAGES_DIRECTORY } from "../../src/core/layout.js";

let root: string;
let output: string[];

function into(...segments: string[]): string {
  return path.join(root, ...segments);
}

function readManifest(): ReturnType<typeof parseManifest> {
  return parseManifest(fs.readFileSync(into(MANIFEST_FILE), "utf8"));
}

function read(...segments: string[]): string {
  return fs.readFileSync(into(...segments), "utf8");
}

async function peta(...argv: string[]): Promise<number> {
  return run([...argv, "-C", root]);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "peta-init-"));
  output = [];
  vi.spyOn(console, "log").mockImplementation((text: unknown) => {
    output.push(String(text));
  });
  vi.spyOn(console, "error").mockImplementation((text: unknown) => {
    output.push(String(text));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("peta init app", () => {
  it("is what a bare init creates", async () => {
    expect(await peta("init")).toBe(0);
    expect(readManifest().name).toBeNull();
    expect(fs.existsSync(into("src", "main.tera"))).toBe(true);
  });

  it("writes a runnable entry rather than an empty file", async () => {
    await peta("init", "app");
    const source = read("src", "main.tera");
    expect(source).toContain("fn greet(who: string) -> string:");
    expect(source).toContain('print(greet("world"))');
  });

  it("leaves the manifest without an identity", async () => {
    await peta("init", "app");
    expect(JSON.parse(read(MANIFEST_FILE))).toEqual({ modules: "src", dependencies: {} });
  });

  it("accepts an optional name", async () => {
    expect(await peta("init", "app", "slexis.tool")).toBe(0);
    const manifest = readManifest();
    expect(manifest.name?.text).toBe("slexis.tool");
    expect(fs.existsSync(into("src", "main.tera"))).toBe(true);
  });

  it("says how to run what it made", async () => {
    await peta("init", "app");
    expect(output.join("\n")).toContain("tera src/main.tera");
  });
});

describe("peta init package", () => {
  it("writes a package index, a manifest with an identity, and a readme", async () => {
    expect(await peta("init", "package", "slexis.http")).toBe(0);
    const manifest = readManifest();
    expect(manifest.name?.text).toBe("slexis.http");
    expect(fs.existsSync(into("src", "__init__.tera"))).toBe(true);
    expect(fs.existsSync(into("src", "main.tera"))).toBe(false);
    expect(fs.existsSync(into("README.md"))).toBe(true);
  });

  it("starts at 0.1.0", async () => {
    await peta("init", "package", "slexis.http");
    expect(JSON.parse(read(MANIFEST_FILE)).version).toBe("0.1.0");
  });

  it("names the package in its own source and readme", async () => {
    await peta("init", "package", "slexis.http");
    expect(read("src", "__init__.tera")).toContain("hello from slexis.http");
    expect(read("README.md")).toContain("peta install slexis.http");
    expect(read("README.md")).toContain("import slexis.http");
  });

  it("refuses to make a package with no name", async () => {
    expect(await peta("init", "package")).toBe(2);
    expect(output.join("\n")).toContain("a package needs a name");
  });

  it("rejects a name that is not a package name", async () => {
    expect(await peta("init", "package", "Slexis.Http")).toBe(1);
    expect(fs.existsSync(into(MANIFEST_FILE))).toBe(false);
  });
});

describe("peta init argument handling", () => {
  it("asks which kind when given only a name", async () => {
    expect(await peta("init", "slexis.http")).toBe(2);
    expect(output.join("\n")).toContain("peta init package slexis.http");
  });

  it("rejects a first token that is neither a kind nor a name", async () => {
    expect(await peta("init", "Not-A-Kind")).toBe(2);
    expect(output.join("\n")).toContain("expected 'app' or 'package'");
  });

  it("rejects a second name", async () => {
    expect(await peta("init", "package", "a.b", "c.d")).toBe(2);
  });

  it("honours a custom module directory", async () => {
    expect(await peta("init", "package", "slexis.http", "--modules", "lib")).toBe(0);
    expect(readManifest().modules).toBe("lib");
    expect(fs.existsSync(into("lib", "__init__.tera"))).toBe(true);
  });

  it("refuses to overwrite an existing manifest", async () => {
    await peta("init", "app");
    expect(await peta("init", "app")).toBe(2);
  });
});

describe("peta init and git", () => {
  it("ignores the package directory", async () => {
    await peta("init", "app");
    expect(read(".gitignore")).toContain(`${PACKAGES_DIRECTORY}/`);
  });

  it("appends to an existing .gitignore exactly once", async () => {
    fs.writeFileSync(into(".gitignore"), "dist/\n", "utf8");
    await peta("init", "app");
    expect(read(".gitignore").trim().split(/\r?\n/)).toEqual([
      "dist/",
      `${PACKAGES_DIRECTORY}/`,
    ]);
  });
});

describe("peta help and version", () => {
  it("lists the commands", async () => {
    expect(await run([])).toBe(0);
    expect(output.join("\n")).toContain("init");
  });

  it("reports an unknown command as a usage error", async () => {
    expect(await run(["frobnicate"])).toBe(2);
  });
});
