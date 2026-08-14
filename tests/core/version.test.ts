import { describe, it, expect } from "vitest";
import {
  compareVersion,
  formatVersion,
  isPrerelease,
  parseVersion,
  tryParseVersion,
} from "../../src/core/version.js";
import { VersionError } from "../../src/core/errors.js";

function ordered(versions: readonly string[]): void {
  for (let at = 0; at + 1 < versions.length; at++) {
    const left = parseVersion(versions[at]!);
    const right = parseVersion(versions[at + 1]!);
    expect(compareVersion(left, right), `${versions[at]} < ${versions[at + 1]}`).toBeLessThan(0);
    expect(compareVersion(right, left), `${versions[at + 1]} > ${versions[at]}`).toBeGreaterThan(0);
  }
}

describe("parseVersion", () => {
  it("reads the core triple", () => {
    expect(parseVersion("1.2.3")).toMatchObject({ major: 1, minor: 2, patch: 3 });
  });

  it("reads prerelease and build identifiers", () => {
    const version = parseVersion("1.0.0-alpha.1+build.7");
    expect(version.prerelease).toEqual(["alpha", "1"]);
    expect(version.build).toEqual(["build", "7"]);
    expect(isPrerelease(version)).toBe(true);
  });

  it("rejects leading zeroes in the core triple", () => {
    expect(tryParseVersion("01.2.3")).toBeNull();
    expect(tryParseVersion("1.02.3")).toBeNull();
    expect(tryParseVersion("1.2.03")).toBeNull();
  });

  it("rejects leading zeroes in numeric prerelease identifiers", () => {
    expect(tryParseVersion("1.0.0-01")).toBeNull();
    expect(tryParseVersion("1.0.0-0a")).not.toBeNull();
  });

  it("rejects partial and malformed versions", () => {
    for (const text of ["1", "1.2", "1.2.3.4", "v1.2.3", "1.2.x", "", "1.2.3-"]) {
      expect(tryParseVersion(text), text).toBeNull();
    }
  });

  it("throws a VersionError from the strict entry point", () => {
    expect(() => parseVersion("nope")).toThrow(VersionError);
  });
});

describe("compareVersion", () => {
  it("orders the core triple before anything else", () => {
    ordered(["1.0.0", "1.0.1", "1.1.0", "2.0.0", "10.0.0"]);
  });

  it("follows the semver precedence example", () => {
    ordered([
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
    ]);
  });

  it("treats a shorter matching prerelease as lower", () => {
    ordered(["1.0.0-alpha", "1.0.0-alpha.1"]);
  });

  it("ignores build metadata", () => {
    const left = parseVersion("1.2.3+a");
    const right = parseVersion("1.2.3+b");
    expect(compareVersion(left, right)).toBe(0);
  });
});

describe("formatVersion", () => {
  it("round-trips every part", () => {
    for (const text of ["1.2.3", "0.0.1-alpha.2", "2.0.0+build.1", "1.0.0-rc.1+exp.sha.5114f85"]) {
      expect(formatVersion(parseVersion(text))).toBe(text);
    }
  });
});
