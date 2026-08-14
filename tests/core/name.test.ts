import { describe, it, expect } from "vitest";
import {
  isReservedName,
  modulePathOf,
  parsePackageName,
  scopeOf,
  tryParsePackageName,
} from "../../src/core/name.js";
import { PackageNameError } from "../../src/core/errors.js";

describe("parsePackageName", () => {
  it("splits dotted segments", () => {
    expect(parsePackageName("slexis.http").segments).toEqual(["slexis", "http"]);
    expect(parsePackageName("acme.net.url_parse").segments).toEqual(["acme", "net", "url_parse"]);
  });

  it("accepts a single reserved segment", () => {
    const name = parsePackageName("http");
    expect(isReservedName(name)).toBe(true);
  });

  it("marks scoped names as not reserved", () => {
    expect(isReservedName(parsePackageName("slexis.http"))).toBe(false);
  });

  it("rejects segments that are not lowercase identifiers", () => {
    for (const text of ["Slexis.http", "slexis.Http", "9lives.http", "slexis..http", "slexis.", "slexis.http-client"]) {
      expect(tryParsePackageName(text), text).toBeNull();
    }
  });

  it("rejects more than four segments", () => {
    expect(tryParsePackageName("a.b.c.d")).not.toBeNull();
    expect(tryParsePackageName("a.b.c.d.e")).toBeNull();
  });

  it("rejects a reserved word supplied by the caller", () => {
    const reserved = new Set(["if"]);
    expect(tryParsePackageName("if.http", { reserved })).toBeNull();
    expect(tryParsePackageName("iffy.http", { reserved })).not.toBeNull();
    expect(() => parsePackageName("if.http", { reserved })).toThrow(PackageNameError);
  });
});

describe("modulePathOf", () => {
  it("maps a name onto the installed directory layout", () => {
    expect(modulePathOf(parsePackageName("slexis.http"), "/")).toBe("slexis/http");
    expect(modulePathOf(parsePackageName("slexis.http"), "\\")).toBe("slexis\\http");
  });
});

describe("scopeOf", () => {
  it("returns the owning first segment", () => {
    expect(scopeOf(parsePackageName("slexis.http"))).toBe("slexis");
  });
});
