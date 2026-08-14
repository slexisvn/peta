import { VersionError } from "./errors.js";

export type Version = {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly string[];
  readonly build: readonly string[];
};

const VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

const NUMERIC = /^(?:0|[1-9]\d*)$/;

function isNumeric(identifier: string): boolean {
  return NUMERIC.test(identifier);
}

function identifiers(group: string | undefined): readonly string[] {
  return group === undefined ? [] : group.split(".");
}

export function tryParseVersion(text: string): Version | null {
  const match = VERSION_PATTERN.exec(text);
  if (match === null) return null;
  const prerelease = identifiers(match[4]);
  if (prerelease.some((part) => /^\d/.test(part) && !isNumeric(part) && !/[A-Za-z-]/.test(part))) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease,
    build: identifiers(match[5]),
  };
}

export function parseVersion(text: string): Version {
  const version = tryParseVersion(text);
  if (version === null) throw new VersionError(`invalid version '${text}'`);
  return version;
}

export function isPrerelease(version: Version): boolean {
  return version.prerelease.length > 0;
}

export function formatVersion(version: Version): string {
  const core = `${version.major}.${version.minor}.${version.patch}`;
  const pre = isPrerelease(version) ? `-${version.prerelease.join(".")}` : "";
  const build = version.build.length > 0 ? `+${version.build.join(".")}` : "";
  return `${core}${pre}${build}`;
}

function compareIdentifier(left: string, right: string): number {
  const leftNumeric = isNumeric(left);
  const rightNumeric = isNumeric(right);
  if (leftNumeric && rightNumeric) return Number(left) - Number(right);
  if (leftNumeric) return -1;
  if (rightNumeric) return 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

function comparePrerelease(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;
  const shared = Math.min(left.length, right.length);
  for (let at = 0; at < shared; at++) {
    const order = compareIdentifier(left[at]!, right[at]!);
    if (order !== 0) return order;
  }
  return left.length - right.length;
}

export function compareVersion(left: Version, right: Version): number {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  if (left.patch !== right.patch) return left.patch - right.patch;
  return comparePrerelease(left.prerelease, right.prerelease);
}

export function sharesRelease(left: Version, right: Version): boolean {
  return left.major === right.major && left.minor === right.minor && left.patch === right.patch;
}

export function nextMajor(version: Version): Version {
  return { major: version.major + 1, minor: 0, patch: 0, prerelease: [], build: [] };
}

export function nextMinor(version: Version): Version {
  return { major: version.major, minor: version.minor + 1, patch: 0, prerelease: [], build: [] };
}

export function nextPatch(version: Version): Version {
  return {
    major: version.major,
    minor: version.minor,
    patch: version.patch + 1,
    prerelease: [],
    build: [],
  };
}
