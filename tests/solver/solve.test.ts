import { describe, it, expect } from "vitest";
import { solve, SolveFailure, type PackageProvider } from "../../src/solver/solve.js";
import { formatVersion, parseVersion } from "../../src/core/version.js";
import { fromRange } from "../../src/core/version-set.js";
import { parseRange } from "../../src/core/range.js";

type Universe = Record<string, Record<string, Record<string, string>>>;

function providerFor(universe: Universe): PackageProvider {
  return {
    versions: async (name) => Object.keys(universe[name] ?? {}).map(parseVersion),
    dependencies: async (name, version) => {
      const entry = universe[name]?.[formatVersion(version)] ?? {};
      return Object.entries(entry).map(([dependency, range]) => ({
        name: dependency,
        set: fromRange(parseRange(range)),
      }));
    },
  };
}

async function resolve(universe: Universe): Promise<Record<string, string>> {
  const solution = await solve({
    root: "root",
    rootVersion: parseVersion("1.0.0"),
    provider: providerFor(universe),
  });
  return Object.fromEntries(
    [...solution].map(([name, version]) => [name, formatVersion(version)]),
  );
}

async function failure(universe: Universe): Promise<string> {
  try {
    await resolve(universe);
  } catch (error) {
    if (error instanceof SolveFailure) return error.message;
    throw error;
  }
  throw new Error("expected resolution to fail");
}

describe("solve", () => {
  it("resolves a single dependency to its highest match", async () => {
    expect(
      await resolve({
        root: { "1.0.0": { foo: "^1.0.0" } },
        foo: { "1.0.0": {}, "1.2.0": {}, "2.0.0": {} },
      }),
    ).toEqual({ foo: "1.2.0" });
  });

  it("resolves transitive dependencies", async () => {
    expect(
      await resolve({
        root: { "1.0.0": { foo: "^1.0.0" } },
        foo: { "1.0.0": { bar: "^2.0.0" } },
        bar: { "2.0.0": { baz: "^3.0.0" }, "2.1.0": { baz: "^3.0.0" } },
        baz: { "3.0.0": {}, "3.4.0": {} },
      }),
    ).toEqual({ foo: "1.0.0", bar: "2.1.0", baz: "3.4.0" });
  });

  it("intersects two requirements on the same package", async () => {
    expect(
      await resolve({
        root: { "1.0.0": { foo: "^1.0.0", bar: "^1.0.0" } },
        foo: { "1.0.0": { shared: ">=1.0.0, <3.0.0" } },
        bar: { "1.0.0": { shared: ">=1.5.0, <2.5.0" } },
        shared: { "1.0.0": {}, "2.0.0": {}, "2.6.0": {}, "3.0.0": {} },
      }),
    ).toEqual({ foo: "1.0.0", bar: "1.0.0", shared: "2.0.0" });
  });

  it("backtracks out of a bad first choice", async () => {
    expect(
      await resolve({
        root: { "1.0.0": { foo: "^1.0.0", target: "^2.0.0" } },
        foo: { "1.0.0": {}, "1.1.0": { left: "^1.0.0", right: "^1.0.0" } },
        left: { "1.0.0": { shared: ">=1.0.0" } },
        right: { "1.0.0": { shared: "<2.0.0" } },
        shared: { "1.0.0": { target: "^1.0.0" }, "2.0.0": {} },
        target: { "1.0.0": {}, "2.0.0": {} },
      }),
    ).toEqual({ foo: "1.0.0", target: "2.0.0" });
  });

  it("walks back through several versions to find one that fits", async () => {
    expect(
      await resolve({
        root: { "1.0.0": { foo: "*", bar: "*" } },
        foo: {
          "1.0.0": { bar: "^1.0.0" },
          "1.1.0": { bar: "^2.0.0" },
          "1.2.0": { bar: "^3.0.0" },
        },
        bar: { "1.0.0": {} },
      }),
    ).toEqual({ foo: "1.0.0", bar: "1.0.0" });
  });

  it("ignores prereleases unless a bound names one", async () => {
    expect(
      await resolve({
        root: { "1.0.0": { foo: "^1.0.0" } },
        foo: { "1.0.0": {}, "1.1.0-beta.1": {} },
      }),
    ).toEqual({ foo: "1.0.0" });

    expect(
      await resolve({
        root: { "1.0.0": { foo: "^1.1.0-beta.1" } },
        foo: { "1.0.0": {}, "1.1.0-beta.1": {} },
      }),
    ).toEqual({ foo: "1.1.0-beta.1" });
  });
});

describe("solve failures", () => {
  it("reports a package that does not exist", async () => {
    const message = await failure({
      root: { "1.0.0": { foo: "^1.0.0" } },
    });
    expect(message).toContain("foo does not exist");
  });

  it("reports a requirement no version satisfies", async () => {
    const message = await failure({
      root: { "1.0.0": { foo: "^2.0.0" } },
      foo: { "1.0.0": {} },
    });
    expect(message).toContain("no versions of foo match >=2.0.0 <3.0.0");
  });

  it("explains a transitive dead end as a chain", async () => {
    const message = await failure({
      root: { "1.0.0": { foo: "^1.0.0" } },
      foo: { "1.0.0": { bar: "^2.0.0" } },
      bar: { "1.0.0": {} },
    });
    expect(message).toContain("foo 1.0.0 depends on bar >=2.0.0 <3.0.0");
    expect(message).toContain("no versions of bar match >=2.0.0 <3.0.0");
    expect(message).toContain("root 1.0.0 depends on foo >=1.0.0 <2.0.0");
    expect(message.trimEnd().endsWith("version solving failed.")).toBe(true);
  });

  it("derives the whole chain when two packages disagree about a third", async () => {
    const message = await failure({
      root: { "1.0.0": { foo: "^1.0.0", bar: "^1.0.0" } },
      foo: { "1.0.0": { shared: "^1.0.0" } },
      bar: { "1.0.0": { shared: "^2.0.0" } },
      shared: { "1.0.0": {}, "2.0.0": {} },
    });
    expect(message.split("\n")).toEqual([
      "Because no versions of bar match >1.0.0 <2.0.0 and bar 1.0.0 depends on shared >=2.0.0 <3.0.0, bar >=1.0.0 <2.0.0 requires shared >=2.0.0 <3.0.0.",
      "And because foo 1.0.0 depends on shared >=1.0.0 <2.0.0, bar >=1.0.0 <2.0.0 and foo 1.0.0 are incompatible.",
      "And because no versions of foo match >1.0.0 <2.0.0, bar >=1.0.0 <2.0.0 and foo >=1.0.0 <2.0.0 are incompatible.",
      "And because root 1.0.0 depends on foo >=1.0.0 <2.0.0, bar >=1.0.0 <2.0.0 is forbidden.",
      "And because root 1.0.0 depends on bar >=1.0.0 <2.0.0, version solving failed.",
    ]);
  });

  it("explains two irreconcilable requirements on one package", async () => {
    const message = await failure({
      root: { "1.0.0": { foo: "^1.0.0", bar: "^1.0.0" } },
      foo: { "1.0.0": { shared: "^1.0.0" } },
      bar: { "1.0.0": { shared: "^2.0.0" } },
      shared: { "1.0.0": {}, "2.0.0": {} },
    });
    expect(message).toContain("shared");
    expect(message).toContain("version solving failed");
    expect(message.split("\n").length).toBeGreaterThan(1);
  });

  it("names both requirements in a direct conflict", async () => {
    const message = await failure({
      root: { "1.0.0": { foo: "^1.0.0", bar: "^1.0.0" } },
      foo: { "1.0.0": { shared: "^1.0.0" } },
      bar: { "1.0.0": { shared: "^2.0.0" } },
      shared: { "1.0.0": {}, "2.0.0": {} },
    });
    expect(message).toContain("foo");
    expect(message).toContain("bar");
  });
});
