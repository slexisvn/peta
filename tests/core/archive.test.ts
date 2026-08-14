import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import zlib from "node:zlib";
import {
  ARCHIVE_EXTENSION,
  archiveNameFor,
  extractArchive,
  integrityOf,
  packArchive,
  packageEntries,
  readArchive,
} from "../../src/core/archive.js";
import { ContentError } from "../../src/core/content.js";
import { ArchiveError } from "../../src/core/archive.js";
import { packTar, unpackTar, TarError } from "../../src/core/tar.js";
import { readManifestAt } from "../../src/core/project.js";
import { Sandbox } from "../support/project.js";

let box: Sandbox;

beforeEach(() => {
  box = Sandbox.create("archive");
});

afterEach(() => {
  box.remove();
});

function library(files: Record<string, string>): { root: string } {
  const root = box.package("lib", {
    name: "slexis.json",
    version: "1.2.0",
    files,
  });
  return { root };
}

describe("tar", () => {
  it("round-trips entries", () => {
    const entries = [
      { path: "src/__init__.tera", contents: Buffer.from("x = 1\n") },
      { path: "tera.json", contents: Buffer.from("{}\n") },
    ];
    expect(unpackTar(packTar(entries))).toEqual([
      { path: "src/__init__.tera", contents: Buffer.from("x = 1\n") },
      { path: "tera.json", contents: Buffer.from("{}\n") },
    ]);
  });

  it("pads entries that are not a multiple of the block size", () => {
    const contents = Buffer.alloc(1000, 7);
    const packed = packTar([{ path: "a.tera", contents }]);
    expect(packed.length % 512).toBe(0);
    expect(unpackTar(packed)[0]!.contents).toEqual(contents);
  });

  it("is byte-for-byte deterministic and order independent", () => {
    const first = packTar([
      { path: "b.tera", contents: Buffer.from("b") },
      { path: "a.tera", contents: Buffer.from("a") },
    ]);
    const second = packTar([
      { path: "a.tera", contents: Buffer.from("a") },
      { path: "b.tera", contents: Buffer.from("b") },
    ]);
    expect(first.equals(second)).toBe(true);
  });

  it("carries long paths in the ustar prefix field", () => {
    const deep = `${"nested/".repeat(14)}module.tera`;
    expect(deep.length).toBeGreaterThan(100);
    const packed = packTar([{ path: deep, contents: Buffer.from("x") }]);
    expect(unpackTar(packed)[0]!.path).toBe(deep);
  });

  it("rejects a corrupt header", () => {
    const packed = packTar([{ path: "a.tera", contents: Buffer.from("a") }]);
    packed[0] = 0x41;
    expect(() => unpackTar(packed)).toThrow(TarError);
  });

  it("rejects an archive that is not ustar", () => {
    expect(() => unpackTar(Buffer.alloc(1024, 9))).toThrow(TarError);
  });
});

describe("packArchive", () => {
  it("packs the module tree plus the manifest and readme", () => {
    library({
      "src/__init__.tera": "fn parse(text): return text\n",
      "src/deep/reader.tera": "",
      "README.md": "# json\n",
      "notes.txt": "ignored, outside the module tree\n",
    });
    const manifest = readManifestAt(box.at("lib"));
    const paths = packageEntries(box.at("lib"), manifest).map((entry) => entry.path).sort();
    expect(paths).toEqual(["README.md", "src/__init__.tera", "src/deep/reader.tera", "tera.json"]);
  });

  it("round-trips through gzip back to the same manifest", () => {
    library({ "src/__init__.tera": "x = 1\n" });
    const manifest = readManifestAt(box.at("lib"));
    const archive = packArchive(box.at("lib"), manifest);
    const contents = readArchive(archive);
    expect(contents.manifest.name?.text).toBe("slexis.json");
    expect(contents.entries.map((entry) => entry.path).sort()).toEqual([
      "src/__init__.tera",
      "tera.json",
    ]);
  });

  it("produces the same bytes for the same input", () => {
    library({ "src/__init__.tera": "x = 1\n" });
    const manifest = readManifestAt(box.at("lib"));
    const first = packArchive(box.at("lib"), manifest);
    const second = packArchive(box.at("lib"), manifest);
    expect(integrityOf(first)).toBe(integrityOf(second));
    expect(integrityOf(first).startsWith("sha256-")).toBe(true);
  });

  it("refuses host code inside the module tree", () => {
    library({ "src/__init__.tera": "", "src/native.js": "module.exports = {}\n" });
    const manifest = readManifestAt(box.at("lib"));
    expect(() => packageEntries(box.at("lib"), manifest)).toThrow(ContentError);
    expect(() => packageEntries(box.at("lib"), manifest)).toThrow(/host code/);
  });

  it("honours 'include' as a whitelist over the module tree", () => {
    box.package("lib", {
      name: "slexis.json",
      version: "1.2.0",
      files: {
        "src/__init__.tera": "x = 1\n",
        "src/fixtures/big.csv": "a,b\n",
        "src/writer.tera": "",
      },
    });
    box.write("lib/tera.json", JSON.stringify({
      name: "slexis.json",
      version: "1.2.0",
      modules: "src",
      include: ["src/*.tera"],
    }, null, 2));
    const manifest = readManifestAt(box.at("lib"));
    expect(packageEntries(box.at("lib"), manifest).map((entry) => entry.path).sort()).toEqual([
      "src/__init__.tera",
      "src/writer.tera",
      "tera.json",
    ]);
  });

  it("still ships the manifest and readme when 'include' names neither", () => {
    box.package("lib", {
      name: "slexis.json",
      version: "1.2.0",
      files: { "src/__init__.tera": "", "README.md": "# json\n" },
    });
    box.write("lib/tera.json", JSON.stringify({
      name: "slexis.json",
      version: "1.2.0",
      modules: "src",
      include: ["src/**/*.tera"],
    }, null, 2));
    const manifest = readManifestAt(box.at("lib"));
    expect(packageEntries(box.at("lib"), manifest).map((entry) => entry.path).sort()).toEqual([
      "README.md",
      "src/__init__.tera",
      "tera.json",
    ]);
  });

  it("refuses an 'include' that matches nothing", () => {
    box.package("lib", {
      name: "slexis.json",
      version: "1.2.0",
      files: { "src/__init__.tera": "" },
    });
    box.write("lib/tera.json", JSON.stringify({
      name: "slexis.json",
      version: "1.2.0",
      modules: "src",
      include: ["src/*.csv"],
    }, null, 2));
    const manifest = readManifestAt(box.at("lib"));
    expect(() => packageEntries(box.at("lib"), manifest)).toThrow(/matches 'include'/);
  });

  it("names the archive after the package and version", () => {
    library({ "src/__init__.tera": "" });
    const manifest = readManifestAt(box.at("lib"));
    expect(archiveNameFor(manifest)).toBe(`slexis.json-1.2.0${ARCHIVE_EXTENSION}`);
  });
});

describe("readArchive rejects hostile archives", () => {
  function archiveOf(entries: readonly { path: string; contents: Buffer }[]): Buffer {
    return zlib.gzipSync(packTar(entries));
  }

  const manifest = Buffer.from(`{"name":"slexis.json","version":"1.0.0"}\n`);

  it("rejects a path that escapes the package root", () => {
    const archive = archiveOf([
      { path: "tera.json", contents: manifest },
      { path: "../outside.tera", contents: Buffer.from("x") },
    ]);
    expect(() => readArchive(archive)).toThrow(/escapes the package root/);
  });

  it("rejects an absolute path", () => {
    const archive = archiveOf([
      { path: "tera.json", contents: manifest },
      { path: "/etc/passwd.tera", contents: Buffer.from("x") },
    ]);
    expect(() => readArchive(archive)).toThrow(/escapes the package root/);
  });

  it("rejects an entry with a forbidden extension", () => {
    const archive = archiveOf([
      { path: "tera.json", contents: manifest },
      { path: "src/payload.wasm", contents: Buffer.from("x") },
    ]);
    expect(() => readArchive(archive)).toThrow(/host code/);
  });

  it("rejects an archive without a manifest", () => {
    const archive = archiveOf([{ path: "src/__init__.tera", contents: Buffer.from("x") }]);
    expect(() => readArchive(archive)).toThrow(ArchiveError);
  });
});

describe("extractArchive", () => {
  it("writes the package to disk", () => {
    library({ "src/__init__.tera": "x = 1\n", "README.md": "# json\n" });
    const manifest = readManifestAt(box.at("lib"));
    const archive = packArchive(box.at("lib"), manifest);
    const target = box.at("unpacked");

    expect(extractArchive(archive, target).name?.text).toBe("slexis.json");
    expect(fs.readFileSync(box.at("unpacked", "src", "__init__.tera"), "utf8")).toBe("x = 1\n");
    expect(fs.existsSync(box.at("unpacked", "tera.json"))).toBe(true);
  });
});
