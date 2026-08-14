import { describe, expect, it } from "vitest";
import {
  describeChange,
  diffSurfaces,
  highestImpact,
  requiredVersion,
  verifyBump,
  type Impact,
  type ModuleSurface,
  type PackageSurface,
  type SurfaceChange,
} from "../../src/core/interface-diff.js";
import { formatVersion, parseVersion } from "../../src/core/version.js";

function surface(modules: Record<string, ModuleSurface>): PackageSurface {
  return new Map(Object.entries(modules));
}

function one(module: ModuleSurface): PackageSurface {
  return surface({ "": module });
}

const accepts = (actual: string, expected: string): boolean => {
  if (actual === expected) return true;
  const widenings: Record<string, readonly string[]> = {
    int: ["float", "int | string", "int | null"],
    float: ["float | null"],
  };
  return (widenings[actual] ?? []).includes(expected);
};

function changes(previous: PackageSurface, next: PackageSurface): readonly SurfaceChange[] {
  return diffSurfaces(previous, next, { accepts });
}

function impactOf(previous: PackageSurface, next: PackageSurface): Impact {
  return highestImpact(changes(previous, next));
}

function fetchSignature(params: unknown[], returns = "string"): ModuleSurface {
  return { builtins: [{ name: "fetch", params: params as never, returns }] };
}

describe("surface diff", () => {
  it("sees no change in an identical surface", () => {
    const same = one(fetchSignature([{ name: "path", type: "string" }]));
    expect(changes(same, same)).toEqual([]);
    expect(impactOf(same, same)).toBe("compatible");
  });

  it("calls a removed export breaking and names it", () => {
    const removed = changes(one(fetchSignature([])), one({}));
    expect(removed).toHaveLength(1);
    expect(describeChange(removed[0]!)).toBe("fetch: the function was removed");
    expect(removed[0]!.impact).toBe("breaking");
  });

  it("calls a new export additive", () => {
    expect(impactOf(one({}), one(fetchSignature([])))).toBe("additive");
  });

  it("calls a removed module breaking and a new module additive", () => {
    const before = surface({ "": {}, client: fetchSignature([]) });
    const after = surface({ "": {}, server: fetchSignature([]) });
    const diff = changes(before, after);
    expect(diff.find((change) => change.module === "client")?.impact).toBe("breaking");
    expect(diff.find((change) => change.module === "server")?.impact).toBe("additive");
  });

  it("calls a name that changed kind breaking", () => {
    const diff = changes(one(fetchSignature([])), one({ values: [{ name: "fetch", type: "int" }] }));
    expect(diff).toHaveLength(1);
    expect(diff[0]!.impact).toBe("breaking");
    expect(diff[0]!.reason).toContain("value now");
  });
});

describe("signature changes", () => {
  it("calls an added required parameter breaking", () => {
    expect(
      impactOf(
        one(fetchSignature([{ name: "path", type: "string" }])),
        one(fetchSignature([{ name: "path", type: "string" }, { name: "retries", type: "int" }])),
      ),
    ).toBe("breaking");
  });

  it("calls an added optional parameter additive", () => {
    expect(
      impactOf(
        one(fetchSignature([{ name: "path", type: "string" }])),
        one(
          fetchSignature([
            { name: "path", type: "string" },
            { name: "retries", type: "int", optional: true },
          ]),
        ),
      ),
    ).toBe("additive");
  });

  it("calls a removed parameter breaking", () => {
    expect(
      impactOf(
        one(fetchSignature([{ name: "path", type: "string" }])),
        one(fetchSignature([])),
      ),
    ).toBe("breaking");
  });

  it("calls a widened parameter additive and the narrowing back breaking", () => {
    const narrow = one(fetchSignature([{ name: "n", type: "int" }]));
    const wide = one(fetchSignature([{ name: "n", type: "float" }]));
    expect(impactOf(narrow, wide)).toBe("additive");
    expect(impactOf(wide, narrow)).toBe("breaking");
  });

  it("calls a narrowed return additive and a widened return breaking", () => {
    const wide = one(fetchSignature([], "float"));
    const narrow = one(fetchSignature([], "int"));
    expect(impactOf(wide, narrow)).toBe("additive");
    expect(impactOf(narrow, wide)).toBe("breaking");
  });

  it("calls a required parameter that became optional additive", () => {
    expect(
      impactOf(
        one(fetchSignature([{ name: "path", type: "string" }])),
        one(fetchSignature([{ name: "path", type: "string", optional: true }])),
      ),
    ).toBe("additive");
  });

  it("calls an optional parameter that became required breaking", () => {
    expect(
      impactOf(
        one(fetchSignature([{ name: "path", type: "string", optional: true }])),
        one(fetchSignature([{ name: "path", type: "string" }])),
      ),
    ).toBe("breaking");
  });

  it("calls a renamed parameter breaking", () => {
    expect(
      impactOf(
        one(fetchSignature([{ name: "path", type: "string" }])),
        one(fetchSignature([{ name: "url", type: "string" }])),
      ),
    ).toBe("breaking");
  });

  it("calls changed type parameters breaking", () => {
    const before = one({ builtins: [{ name: "map", typeParams: ["T"], params: [], returns: "T" }] });
    const after = one({ builtins: [{ name: "map", typeParams: ["T", "U"], params: [], returns: "T" }] });
    expect(impactOf(before, after)).toBe("breaking");
  });
});

describe("value, alias and interface changes", () => {
  it("calls a widened value type breaking and a narrowed one additive", () => {
    const narrow = one({ values: [{ name: "limit", type: "int" }] });
    const wide = one({ values: [{ name: "limit", type: "float" }] });
    expect(impactOf(narrow, wide)).toBe("breaking");
    expect(impactOf(wide, narrow)).toBe("additive");
  });

  it("calls a redefined alias breaking", () => {
    expect(
      impactOf(
        one({ aliases: [{ name: "Id", type: "int" }] }),
        one({ aliases: [{ name: "Id", type: "string" }] }),
      ),
    ).toBe("breaking");
  });

  it("calls a removed interface field breaking", () => {
    expect(
      impactOf(
        one({ interfaces: [{ name: "Options", fields: { retries: { type: "int" } } }] }),
        one({ interfaces: [{ name: "Options", fields: {} }] }),
      ),
    ).toBe("breaking");
  });

  it("calls a new optional interface field additive and a new required one breaking", () => {
    const before = one({ interfaces: [{ name: "Options", fields: {} }] });
    const optional = one({
      interfaces: [{ name: "Options", fields: { retries: { type: "int", optional: true } } }],
    });
    const required = one({
      interfaces: [{ name: "Options", fields: { retries: { type: "int" } } }],
    });
    expect(impactOf(before, optional)).toBe("additive");
    expect(impactOf(before, required)).toBe("breaking");
  });

  it("calls a field whose type changed breaking", () => {
    expect(
      impactOf(
        one({ interfaces: [{ name: "Options", fields: { retries: { type: "int" } } }] }),
        one({ interfaces: [{ name: "Options", fields: { retries: { type: "string" } } }] }),
      ),
    ).toBe("breaking");
  });
});

describe("without a type oracle", () => {
  it("treats any type change as breaking", () => {
    const before = one(fetchSignature([{ name: "n", type: "int" }]));
    const after = one(fetchSignature([{ name: "n", type: "float" }]));
    expect(highestImpact(diffSurfaces(before, after))).toBe("breaking");
    expect(highestImpact(diffSurfaces(before, after, { accepts }))).toBe("additive");
  });
});

describe("required version", () => {
  const required = (previous: string, impact: Impact): string =>
    formatVersion(requiredVersion(parseVersion(previous), impact));

  it("sends a breaking change past the caret bound", () => {
    expect(required("1.2.3", "breaking")).toBe("2.0.0");
    expect(required("0.1.2", "breaking")).toBe("0.2.0");
    expect(required("0.0.3", "breaking")).toBe("0.0.4");
  });

  it("asks for the smallest compatible release an author can name", () => {
    expect(required("1.2.3", "additive")).toBe("1.3.0");
    expect(required("0.1.2", "additive")).toBe("0.1.3");
    expect(required("0.0.3", "additive")).toBe("0.0.4");
  });

  it("asks only for a new version when nothing changed", () => {
    expect(required("1.2.3", "compatible")).toBe("1.2.4");
    expect(required("0.1.2", "compatible")).toBe("0.1.3");
  });
});

describe("verifyBump", () => {
  const breaking = changes(one(fetchSignature([])), one({}));
  const additive = changes(one({}), one(fetchSignature([])));

  it("accepts a major release for a breaking change", () => {
    const verdict = verifyBump(parseVersion("1.2.3"), parseVersion("2.0.0"), breaking);
    expect(verdict.impact).toBe("breaking");
    expect(verdict.sufficient).toBe(true);
  });

  it("refuses a patch release for a breaking change and says what is needed", () => {
    const verdict = verifyBump(parseVersion("1.2.3"), parseVersion("1.2.4"), breaking);
    expect(verdict.sufficient).toBe(false);
    expect(formatVersion(verdict.required)).toBe("2.0.0");
  });

  it("refuses a patch release for a new export before 1.0", () => {
    expect(verifyBump(parseVersion("0.1.2"), parseVersion("0.1.3"), additive).sufficient).toBe(true);
    expect(verifyBump(parseVersion("1.2.3"), parseVersion("1.2.4"), additive).sufficient).toBe(false);
  });

  it("accepts any newer version when the surface is unchanged", () => {
    const verdict = verifyBump(parseVersion("1.2.3"), parseVersion("1.2.4"), []);
    expect(verdict.impact).toBe("compatible");
    expect(verdict.sufficient).toBe(true);
  });
});
