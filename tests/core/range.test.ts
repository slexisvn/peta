import { describe, it, expect } from "vitest";
import { maxSatisfying, parseRange, satisfies, tryParseRange } from "../../src/core/range.js";
import { parseVersion } from "../../src/core/version.js";
import { VersionRangeError } from "../../src/core/errors.js";

function accepts(range: string, version: string): boolean {
  return satisfies(parseVersion(version), parseRange(range));
}

describe("caret ranges", () => {
  it("allows minor and patch growth above 1.0.0", () => {
    expect(accepts("^1.2.3", "1.2.3")).toBe(true);
    expect(accepts("^1.2.3", "1.9.9")).toBe(true);
    expect(accepts("^1.2.3", "2.0.0")).toBe(false);
    expect(accepts("^1.2.3", "1.2.2")).toBe(false);
  });

  it("locks the minor when the major is zero", () => {
    expect(accepts("^0.2.3", "0.2.9")).toBe(true);
    expect(accepts("^0.2.3", "0.3.0")).toBe(false);
  });

  it("locks the patch when major and minor are zero", () => {
    expect(accepts("^0.0.3", "0.0.3")).toBe(true);
    expect(accepts("^0.0.3", "0.0.4")).toBe(false);
  });

  it("accepts partial versions", () => {
    expect(accepts("^1.2", "1.5.0")).toBe(true);
    expect(accepts("^1.2", "2.0.0")).toBe(false);
    expect(accepts("^1", "1.9.9")).toBe(true);
  });
});

describe("tilde ranges", () => {
  it("allows patch growth only when the minor is given", () => {
    expect(accepts("~1.2.3", "1.2.9")).toBe(true);
    expect(accepts("~1.2.3", "1.3.0")).toBe(false);
    expect(accepts("~1.2", "1.2.9")).toBe(true);
    expect(accepts("~1.2", "1.3.0")).toBe(false);
  });

  it("allows minor growth when only the major is given", () => {
    expect(accepts("~1", "1.9.0")).toBe(true);
    expect(accepts("~1", "2.0.0")).toBe(false);
  });
});

describe("comparator ranges", () => {
  it("reads every operator", () => {
    expect(accepts(">=1.2.3", "1.2.3")).toBe(true);
    expect(accepts(">1.2.3", "1.2.3")).toBe(false);
    expect(accepts("<=1.2.3", "1.2.3")).toBe(true);
    expect(accepts("<1.2.3", "1.2.3")).toBe(false);
    expect(accepts("=1.2.3", "1.2.3")).toBe(true);
  });

  it("intersects comma separated terms", () => {
    expect(accepts(">=1.2.0, <2.0.0", "1.9.0")).toBe(true);
    expect(accepts(">=1.2.0, <2.0.0", "2.0.0")).toBe(false);
    expect(accepts(">=1.2.0, <2.0.0", "1.1.0")).toBe(false);
  });

  it("treats a bare partial version as a range and a full one as exact", () => {
    expect(accepts("1.2", "1.2.9")).toBe(true);
    expect(accepts("1.2", "1.3.0")).toBe(false);
    expect(accepts("1.2.3", "1.2.4")).toBe(false);
  });

  it("accepts everything under the wildcard", () => {
    expect(accepts("*", "0.0.1")).toBe(true);
    expect(accepts("*", "99.0.0")).toBe(true);
  });
});

describe("prereleases", () => {
  it("are excluded unless the range names the same release", () => {
    expect(accepts("^1.2.3", "1.5.0-beta.1")).toBe(false);
    expect(accepts(">=1.0.0", "2.0.0-rc.1")).toBe(false);
  });

  it("are admitted when a comparator names that release", () => {
    expect(accepts("^1.2.3-alpha.1", "1.2.3-alpha.2")).toBe(true);
    expect(accepts("^1.2.3-alpha.1", "1.2.3-alpha.0")).toBe(false);
    expect(accepts("^1.2.3-alpha.1", "1.4.0-beta.1")).toBe(false);
  });

  it("never block a stable version", () => {
    expect(accepts("^1.2.3-alpha.1", "1.4.0")).toBe(true);
  });
});

describe("maxSatisfying", () => {
  it("returns the highest match", () => {
    const versions = ["1.0.0", "1.4.2", "1.9.0", "2.0.0"].map(parseVersion);
    expect(maxSatisfying(versions, parseRange("^1.0.0"))?.minor).toBe(9);
  });

  it("returns null when nothing matches", () => {
    const versions = ["1.0.0", "1.4.2"].map(parseVersion);
    expect(maxSatisfying(versions, parseRange("^2.0.0"))).toBeNull();
  });
});

describe("invalid ranges", () => {
  it("are rejected", () => {
    for (const text of ["", "^", "~", ">=", "abc", "^1.2.x", ">=1.2.3 <2.0.0"]) {
      expect(tryParseRange(text), text).toBeNull();
    }
  });

  it("throw from the strict entry point", () => {
    expect(() => parseRange("nope")).toThrow(VersionRangeError);
  });
});
