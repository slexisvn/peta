import { describe, it, expect } from "vitest";
import {
  complement,
  contains,
  difference,
  emptySet,
  formatSet,
  fromRange,
  fullSet,
  intersect,
  isEmpty,
  isFull,
  isSubset,
  setsEqual,
  singleton,
  union,
} from "../../src/core/version-set.js";
import { parseRange } from "../../src/core/range.js";
import { parseVersion } from "../../src/core/version.js";

function set(text: string) {
  return fromRange(parseRange(text));
}

function holds(text: string, version: string): boolean {
  return contains(set(text), parseVersion(version));
}

describe("fromRange", () => {
  it("turns a caret range into a half-open interval", () => {
    expect(formatSet(set("^1.2.3"))).toBe(">=1.2.3 <2.0.0");
    expect(formatSet(set("^0.2.3"))).toBe(">=0.2.3 <0.3.0");
  });

  it("turns an exact range into a point", () => {
    expect(formatSet(set("1.2.3"))).toBe("1.2.3");
  });

  it("turns a wildcard into the full set", () => {
    expect(isFull(set("*"))).toBe(true);
  });

  it("intersects conjunctions", () => {
    expect(formatSet(set(">=1.0.0, <1.5.0"))).toBe(">=1.0.0 <1.5.0");
  });

  it("collapses an impossible conjunction to empty", () => {
    expect(isEmpty(set(">=2.0.0, <1.0.0"))).toBe(true);
  });
});

describe("contains", () => {
  it("respects bound inclusivity", () => {
    expect(holds(">=1.2.3", "1.2.3")).toBe(true);
    expect(holds(">1.2.3", "1.2.3")).toBe(false);
    expect(holds("<=1.2.3", "1.2.3")).toBe(true);
    expect(holds("<1.2.3", "1.2.3")).toBe(false);
  });

  it("orders prereleases below their release", () => {
    expect(holds(">=1.0.0", "1.0.0-rc.1")).toBe(false);
    expect(holds("<1.0.0", "1.0.0-rc.1")).toBe(true);
  });
});

describe("intersect", () => {
  it("keeps the overlap", () => {
    expect(formatSet(intersect(set("^1.0.0"), set(">=1.5.0")))).toBe(">=1.5.0 <2.0.0");
  });

  it("is empty for disjoint sets", () => {
    expect(isEmpty(intersect(set("^1.0.0"), set("^2.0.0")))).toBe(true);
  });

  it("distributes over a union", () => {
    const left = union(set("^1.0.0"), set("^3.0.0"));
    expect(formatSet(intersect(left, set(">=1.5.0, <3.5.0")))).toBe(
      ">=1.5.0 <2.0.0 || >=3.0.0 <3.5.0",
    );
  });
});

describe("union", () => {
  it("merges overlapping intervals", () => {
    expect(formatSet(union(set(">=1.0.0, <2.0.0"), set(">=1.5.0, <3.0.0")))).toBe(
      ">=1.0.0 <3.0.0",
    );
  });

  it("merges intervals that touch at an inclusive bound", () => {
    expect(formatSet(union(set("<1.0.0"), set(">=1.0.0")))).toBe("*");
  });

  it("keeps a one-point gap between two exclusive bounds", () => {
    expect(formatSet(union(set("<1.0.0"), set(">1.0.0")))).toBe("<1.0.0 || >1.0.0");
  });

  it("keeps disjoint intervals apart and sorted", () => {
    expect(formatSet(union(set("^3.0.0"), set("^1.0.0")))).toBe(
      ">=1.0.0 <2.0.0 || >=3.0.0 <4.0.0",
    );
  });
});

describe("complement", () => {
  it("inverts the full and empty sets", () => {
    expect(isEmpty(complement(fullSet()))).toBe(true);
    expect(isFull(complement(emptySet()))).toBe(true);
  });

  it("produces the gaps around an interval", () => {
    expect(formatSet(complement(set("^1.0.0")))).toBe("<1.0.0 || >=2.0.0");
  });

  it("is an involution", () => {
    for (const text of ["^1.2.3", ">=1.0.0", "<2.0.0", "1.2.3", "*"]) {
      expect(setsEqual(complement(complement(set(text))), set(text)), text).toBe(true);
    }
  });

  it("excludes exactly one point when complementing a singleton", () => {
    const excluded = complement(singleton(parseVersion("1.2.3")));
    expect(contains(excluded, parseVersion("1.2.3"))).toBe(false);
    expect(contains(excluded, parseVersion("1.2.4"))).toBe(true);
    expect(formatSet(excluded)).toBe("<1.2.3 || >1.2.3");
  });
});

describe("difference and subset", () => {
  it("removes a hole from an interval", () => {
    const holed = difference(set("^1.0.0"), singleton(parseVersion("1.5.0")));
    expect(contains(holed, parseVersion("1.5.0"))).toBe(false);
    expect(contains(holed, parseVersion("1.4.9"))).toBe(true);
    expect(contains(holed, parseVersion("1.5.1"))).toBe(true);
  });

  it("recognises containment", () => {
    expect(isSubset(set("^1.2.0"), set("^1.0.0"))).toBe(true);
    expect(isSubset(set("^1.0.0"), set("^1.2.0"))).toBe(false);
    expect(isSubset(emptySet(), set("^1.0.0"))).toBe(true);
    expect(isSubset(set("^1.0.0"), fullSet())).toBe(true);
  });
});

describe("formatSet", () => {
  it("names the empty set", () => {
    expect(formatSet(emptySet())).toBe("<none>");
  });
});
