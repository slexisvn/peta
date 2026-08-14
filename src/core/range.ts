import { VersionRangeError } from "./errors.js";
import {
  compareVersion,
  formatVersion,
  isPrerelease,
  nextMajor,
  nextMinor,
  nextPatch,
  sharesRelease,
  tryParseVersion,
  type Version,
} from "./version.js";

export type ComparatorOperator = "<" | "<=" | "=" | ">=" | ">";

export type Comparator = {
  readonly operator: ComparatorOperator;
  readonly version: Version;
};

export type Range = {
  readonly comparators: readonly Comparator[];
  readonly text: string;
};

const ANY = "*";

const OPERATORS: readonly ComparatorOperator[] = [">=", "<=", ">", "<", "="];

const PARTIAL_PATTERN = /^(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?(?:\.(0|[1-9]\d*))?$/;

type PartialVersion = {
  readonly version: Version;
  readonly precision: 1 | 2 | 3;
};

function partialOf(text: string): PartialVersion | null {
  const match = PARTIAL_PATTERN.exec(text);
  if (match === null) {
    const exact = tryParseVersion(text);
    return exact === null ? null : { version: exact, precision: 3 };
  }
  const precision = match[3] !== undefined ? 3 : match[2] !== undefined ? 2 : 1;
  return {
    version: {
      major: Number(match[1]),
      minor: Number(match[2] ?? 0),
      patch: Number(match[3] ?? 0),
      prerelease: [],
      build: [],
    },
    precision,
  };
}

export function caretBound(version: Version): Version {
  if (version.major !== 0) return nextMajor(version);
  if (version.minor !== 0) return nextMinor(version);
  return nextPatch(version);
}

function tildeBound(partial: PartialVersion): Version {
  return partial.precision === 1 ? nextMajor(partial.version) : nextMinor(partial.version);
}

function boundedBy(lower: Version, upper: Version): readonly Comparator[] {
  return [
    { operator: ">=", version: lower },
    { operator: "<", version: upper },
  ];
}

function comparatorsOf(term: string): readonly Comparator[] {
  if (term === ANY) return [];
  if (term.startsWith("^")) {
    const partial = partialOf(term.slice(1));
    if (partial === null) throw new VersionRangeError(`invalid caret range '${term}'`);
    return boundedBy(partial.version, caretBound(partial.version));
  }
  if (term.startsWith("~")) {
    const partial = partialOf(term.slice(1));
    if (partial === null) throw new VersionRangeError(`invalid tilde range '${term}'`);
    return boundedBy(partial.version, tildeBound(partial));
  }
  const operator = OPERATORS.find((candidate) => term.startsWith(candidate));
  if (operator === undefined) {
    const partial = partialOf(term);
    if (partial === null) throw new VersionRangeError(`invalid version range '${term}'`);
    if (partial.precision === 3) return [{ operator: "=", version: partial.version }];
    return boundedBy(
      partial.version,
      partial.precision === 1 ? nextMajor(partial.version) : nextMinor(partial.version),
    );
  }
  const rest = term.slice(operator.length).trim();
  const version = tryParseVersion(rest);
  if (version === null) throw new VersionRangeError(`invalid version range '${term}'`);
  return [{ operator, version }];
}

export function parseRange(text: string): Range {
  const terms = text
    .split(",")
    .map((term) => term.trim())
    .filter((term) => term.length > 0);
  if (terms.length === 0) throw new VersionRangeError(`empty version range '${text}'`);
  const comparators = terms.flatMap(comparatorsOf);
  return { comparators, text: text.trim() };
}

export function tryParseRange(text: string): Range | null {
  try {
    return parseRange(text);
  } catch (error) {
    if (error instanceof VersionRangeError) return null;
    throw error;
  }
}

export function formatRange(range: Range): string {
  return range.text;
}

function matchesComparator(version: Version, comparator: Comparator): boolean {
  const order = compareVersion(version, comparator.version);
  switch (comparator.operator) {
    case "<":
      return order < 0;
    case "<=":
      return order <= 0;
    case "=":
      return order === 0;
    case ">=":
      return order >= 0;
    case ">":
      return order > 0;
  }
}

function admitsPrerelease(version: Version, range: Range): boolean {
  return range.comparators.some(
    (comparator) => isPrerelease(comparator.version) && sharesRelease(comparator.version, version),
  );
}

export function satisfies(version: Version, range: Range): boolean {
  if (isPrerelease(version) && !admitsPrerelease(version, range)) return false;
  return range.comparators.every((comparator) => matchesComparator(version, comparator));
}

export function maxSatisfying(versions: Iterable<Version>, range: Range): Version | null {
  let best: Version | null = null;
  for (const version of versions) {
    if (!satisfies(version, range)) continue;
    if (best === null || compareVersion(version, best) > 0) best = version;
  }
  return best;
}
