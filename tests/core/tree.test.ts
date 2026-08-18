import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parsePackageName } from "../../src/core/name.js";
import { parseResolvedSource } from "../../src/core/source.js";
import {
  STATE_VERSION,
  contentDigest,
  installedPathFor,
  packageFiles,
  readState,
  syncTree,
  type PackageContents,
} from "../../src/core/tree.js";
import { parseVersion } from "../../src/core/version.js";
import { Sandbox } from "../support/project.js";

let box: Sandbox;

beforeEach(() => {
  box = Sandbox.create("tree");
});

afterEach(() => {
  vi.restoreAllMocks();
  box.remove();
});

const NAME = "slexis.json";
const PARSER = "fn parse(text): return text\n";

function library(files: Record<string, string>, at = "json"): string {
  for (const [file, contents] of Object.entries(files)) box.write(`${at}/${file}`, contents);
  return box.at(at);
}

function contents(directory: string, source = "path:../json"): PackageContents {
  return {
    name: parsePackageName(NAME),
    version: parseVersion("1.2.0"),
    source: parseResolvedSource(source),
    directory,
  };
}

function sync(entry: PackageContents) {
  return syncTree(box.at("app"), [entry]);
}

function installed(file: string): string {
  return box.at("app", "tera_packages", "slexis", "json", file);
}

function stateOf(name = NAME) {
  return readState(box.at("app")).packages.get(name);
}

describe("syncTree materialises a package", () => {
  it("copies the module tree to its import path and records the install", () => {
    const entry = contents(library({ "__init__.tera": PARSER, "writer.tera": "x = 1\n" }));

    const outcome = sync(entry);

    expect(outcome.added).toEqual([NAME]);
    expect(outcome.updated).toEqual([]);
    expect(outcome.unchanged).toEqual([]);
    expect(fs.readFileSync(installed("__init__.tera"), "utf8")).toBe(PARSER);
    expect(stateOf()?.files).toBe(2);
    expect(stateOf()?.digest).toBe(contentDigest(entry.directory, packageFiles(entry.directory)));
  });
});

describe("syncTree re-syncing a path source", () => {
  it("reports an untouched path package as unchanged", () => {
    const entry = contents(library({ "__init__.tera": PARSER }));
    sync(entry);

    const outcome = sync(entry);

    expect(outcome.unchanged).toEqual([NAME]);
    expect(outcome.updated).toEqual([]);
    expect(outcome.added).toEqual([]);
  });

  it("rewrites nothing on disk when nothing was edited", () => {
    const entry = contents(library({ "__init__.tera": PARSER }));
    sync(entry);
    const copied = vi.spyOn(fs, "copyFileSync");
    const removed = vi.spyOn(fs, "rmSync");

    sync(entry);

    expect(copied).not.toHaveBeenCalled();
    expect(removed).not.toHaveBeenCalled();
  });

  it("picks up an edit to the path source", () => {
    const entry = contents(library({ "__init__.tera": PARSER }));
    sync(entry);
    box.write("json/__init__.tera", "fn parse(text): return 0\n");

    const outcome = sync(entry);

    expect(outcome.updated).toEqual([NAME]);
    expect(outcome.unchanged).toEqual([]);
    expect(fs.readFileSync(installed("__init__.tera"), "utf8")).toBe("fn parse(text): return 0\n");
    expect(stateOf()?.digest).toBe(contentDigest(entry.directory, packageFiles(entry.directory)));
  });

  it("sees an edit that keeps every file name and byte count", () => {
    const entry = contents(library({ "__init__.tera": "x = 1\n" }));
    sync(entry);
    box.write("json/__init__.tera", "x = 2\n");

    expect(sync(entry).updated).toEqual([NAME]);
    expect(fs.readFileSync(installed("__init__.tera"), "utf8")).toBe("x = 2\n");
  });

  it("sees a file added to the path source", () => {
    const entry = contents(library({ "__init__.tera": PARSER }));
    sync(entry);
    box.write("json/writer.tera", "y = 2\n");

    expect(sync(entry).updated).toEqual([NAME]);
    expect(fs.existsSync(installed("writer.tera"))).toBe(true);
  });

  it("drops a file the path source no longer has", () => {
    const entry = contents(library({ "__init__.tera": PARSER, "writer.tera": "y = 2\n" }));
    sync(entry);
    fs.rmSync(box.at("json", "writer.tera"));

    expect(sync(entry).updated).toEqual([NAME]);
    expect(fs.existsSync(installed("writer.tera"))).toBe(false);
    expect(stateOf()?.files).toBe(1);
  });

  it("reinstalls when the tree was deleted behind peta's back", () => {
    const entry = contents(library({ "__init__.tera": PARSER }));
    sync(entry);
    fs.rmSync(installedPathFor(box.at("app"), parsePackageName(NAME)), { recursive: true });

    expect(sync(entry).updated).toEqual([NAME]);
    expect(fs.existsSync(installed("__init__.tera"))).toBe(true);
  });

  it("reinstalls when the same directory is now a different version", () => {
    const entry = contents(library({ "__init__.tera": PARSER }));
    sync(entry);

    const outcome = sync({ ...entry, version: parseVersion("1.3.0") });

    expect(outcome.updated).toEqual([NAME]);
    expect(stateOf()?.version).toEqual(parseVersion("1.3.0"));
  });

  it("reinstalls when the package moved to another source", () => {
    const entry = contents(library({ "__init__.tera": PARSER }));
    sync(entry);

    expect(sync(contents(entry.directory, "petahub")).updated).toEqual([NAME]);
  });
});

describe("syncTree removal", () => {
  it("deletes a package that is no longer in the resolution", () => {
    const entry = contents(library({ "__init__.tera": PARSER }));
    sync(entry);

    const outcome = syncTree(box.at("app"), []);

    expect(outcome.removed).toEqual([NAME]);
    expect(fs.existsSync(installedPathFor(box.at("app"), parsePackageName(NAME)))).toBe(false);
    expect(box.list("app/tera_packages")).toEqual([".peta"]);
  });
});

describe("tree state", () => {
  it("ignores a state file written by another state version", () => {
    const entry = contents(library({ "__init__.tera": PARSER }));
    sync(entry);
    const target = box.at("app", "tera_packages", ".peta", "state.json");
    const stored = JSON.parse(fs.readFileSync(target, "utf8")) as Record<string, unknown>;
    fs.writeFileSync(target, JSON.stringify({ ...stored, stateVersion: STATE_VERSION + 1 }));

    expect(readState(box.at("app")).packages.size).toBe(0);
    expect(sync(entry).added).toEqual([NAME]);
  });
});

describe("contentDigest", () => {
  it("separates the file list from the file contents", () => {
    const split = library({ "a.tera": "one", "b.tera": "two" }, "split");
    const joined = library({ "a.tera": "onetwo" }, "joined");

    expect(contentDigest(split, packageFiles(split))).not.toBe(
      contentDigest(joined, packageFiles(joined)),
    );
  });

  it("does not depend on where the package sits on disk", () => {
    const here = library({ "__init__.tera": PARSER }, "here");
    const there = library({ "__init__.tera": PARSER }, "nested/there");

    expect(contentDigest(here, packageFiles(here))).toBe(
      contentDigest(there, packageFiles(there)),
    );
  });
});
