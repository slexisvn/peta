import { describe, it, expect } from "vitest";
import { Glob } from "../../src/core/glob.js";

function matches(patterns: readonly string[], path: string): boolean {
  return new Glob(patterns).matches(path);
}

describe("Glob", () => {
  it("matches everything when it holds no pattern", () => {
    expect(new Glob([]).empty).toBe(true);
    expect(matches([], "anything/at/all.tera")).toBe(true);
  });

  it("matches a literal path", () => {
    expect(matches(["README.md"], "README.md")).toBe(true);
    expect(matches(["README.md"], "docs/README.md")).toBe(false);
  });

  it("keeps a single star inside one segment", () => {
    expect(matches(["src/*.tera"], "src/main.tera")).toBe(true);
    expect(matches(["src/*.tera"], "src/deep/main.tera")).toBe(false);
    expect(matches(["src/*.tera"], "src/main.csv")).toBe(false);
  });

  it("lets a double star cross segments", () => {
    expect(matches(["src/**/*.tera"], "src/main.tera")).toBe(true);
    expect(matches(["src/**/*.tera"], "src/a/b/main.tera")).toBe(true);
    expect(matches(["src/**/*.tera"], "lib/main.tera")).toBe(false);
  });

  it("matches a whole subtree with a trailing double star", () => {
    expect(matches(["data/**"], "data/a.csv")).toBe(true);
    expect(matches(["data/**"], "data/deep/a.csv")).toBe(true);
    expect(matches(["data/**"], "other/a.csv")).toBe(false);
  });

  it("matches one character with a question mark", () => {
    expect(matches(["v?.tera"], "v1.tera")).toBe(true);
    expect(matches(["v?.tera"], "v12.tera")).toBe(false);
  });

  it("takes the union of its patterns", () => {
    const patterns = ["src/**/*.tera", "data/*.csv"];
    expect(matches(patterns, "src/a/b.tera")).toBe(true);
    expect(matches(patterns, "data/iris.csv")).toBe(true);
    expect(matches(patterns, "notes.txt")).toBe(false);
  });

  it("treats a dot as a literal, not a wildcard", () => {
    expect(matches(["a.tera"], "axtera")).toBe(false);
  });

  it("normalises windows separators", () => {
    expect(matches(["src/**/*.tera"], "src\\deep\\main.tera")).toBe(true);
  });
});
