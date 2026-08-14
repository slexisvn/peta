import { compareVersion, formatVersion, type Version } from "./version.js";
import type { Range } from "./range.js";

export type Bound = { readonly version: Version; readonly inclusive: boolean } | null;

export type Interval = {
  readonly lower: Bound;
  readonly upper: Bound;
};

export type VersionSet = {
  readonly intervals: readonly Interval[];
};

const EMPTY: VersionSet = { intervals: [] };
const FULL: VersionSet = { intervals: [{ lower: null, upper: null }] };

export function emptySet(): VersionSet {
  return EMPTY;
}

export function fullSet(): VersionSet {
  return FULL;
}

function compareLower(left: Bound, right: Bound): number {
  if (left === null) return right === null ? 0 : -1;
  if (right === null) return 1;
  const order = compareVersion(left.version, right.version);
  if (order !== 0) return order;
  if (left.inclusive === right.inclusive) return 0;
  return left.inclusive ? -1 : 1;
}

function compareUpper(left: Bound, right: Bound): number {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  const order = compareVersion(left.version, right.version);
  if (order !== 0) return order;
  if (left.inclusive === right.inclusive) return 0;
  return left.inclusive ? 1 : -1;
}

function isEmptyInterval(interval: Interval): boolean {
  const { lower, upper } = interval;
  if (lower === null || upper === null) return false;
  const order = compareVersion(lower.version, upper.version);
  if (order > 0) return true;
  return order === 0 && !(lower.inclusive && upper.inclusive);
}

function touches(left: Interval, right: Interval): boolean {
  if (left.upper === null || right.lower === null) return true;
  const order = compareVersion(left.upper.version, right.lower.version);
  if (order > 0) return true;
  return order === 0 && (left.upper.inclusive || right.lower.inclusive);
}

function normalize(intervals: readonly Interval[]): VersionSet {
  const live = intervals.filter((interval) => !isEmptyInterval(interval));
  if (live.length === 0) return EMPTY;
  const sorted = [...live].sort((left, right) => {
    const order = compareLower(left.lower, right.lower);
    return order !== 0 ? order : compareUpper(left.upper, right.upper);
  });
  const merged: Interval[] = [sorted[0]!];
  for (const interval of sorted.slice(1)) {
    const last = merged[merged.length - 1]!;
    if (!touches(last, interval)) {
      merged.push(interval);
      continue;
    }
    merged[merged.length - 1] = {
      lower: last.lower,
      upper: compareUpper(last.upper, interval.upper) >= 0 ? last.upper : interval.upper,
    };
  }
  return { intervals: merged };
}

export function intervalSet(lower: Bound, upper: Bound): VersionSet {
  return normalize([{ lower, upper }]);
}

export function singleton(version: Version): VersionSet {
  return intervalSet({ version, inclusive: true }, { version, inclusive: true });
}

export function isEmpty(set: VersionSet): boolean {
  return set.intervals.length === 0;
}

export function isFull(set: VersionSet): boolean {
  const only = set.intervals[0];
  return set.intervals.length === 1 && only!.lower === null && only!.upper === null;
}

export function contains(set: VersionSet, version: Version): boolean {
  return set.intervals.some((interval) => {
    const { lower, upper } = interval;
    if (lower !== null) {
      const order = compareVersion(version, lower.version);
      if (order < 0 || (order === 0 && !lower.inclusive)) return false;
    }
    if (upper !== null) {
      const order = compareVersion(version, upper.version);
      if (order > 0 || (order === 0 && !upper.inclusive)) return false;
    }
    return true;
  });
}

function intersectIntervals(left: Interval, right: Interval): Interval {
  return {
    lower: compareLower(left.lower, right.lower) >= 0 ? left.lower : right.lower,
    upper: compareUpper(left.upper, right.upper) <= 0 ? left.upper : right.upper,
  };
}

export function intersect(left: VersionSet, right: VersionSet): VersionSet {
  const intervals: Interval[] = [];
  for (const first of left.intervals) {
    for (const second of right.intervals) {
      const overlap = intersectIntervals(first, second);
      if (!isEmptyInterval(overlap)) intervals.push(overlap);
    }
  }
  return normalize(intervals);
}

export function union(left: VersionSet, right: VersionSet): VersionSet {
  return normalize([...left.intervals, ...right.intervals]);
}

function flip(bound: Bound): Bound {
  return bound === null ? null : { version: bound.version, inclusive: !bound.inclusive };
}

export function complement(set: VersionSet): VersionSet {
  if (isEmpty(set)) return FULL;
  const intervals: Interval[] = [];
  let cursor: Bound = null;
  for (const interval of set.intervals) {
    if (interval.lower !== null) intervals.push({ lower: cursor, upper: flip(interval.lower) });
    cursor = interval.upper === null ? null : flip(interval.upper);
    if (interval.upper === null) return normalize(intervals);
  }
  intervals.push({ lower: cursor, upper: null });
  return normalize(intervals);
}

export function difference(left: VersionSet, right: VersionSet): VersionSet {
  return intersect(left, complement(right));
}

export function isSubset(left: VersionSet, right: VersionSet): boolean {
  return isEmpty(difference(left, right));
}

export function setsEqual(left: VersionSet, right: VersionSet): boolean {
  return isSubset(left, right) && isSubset(right, left);
}

export function fromRange(range: Range): VersionSet {
  let set = FULL;
  for (const comparator of range.comparators) {
    const version = comparator.version;
    switch (comparator.operator) {
      case ">=":
        set = intersect(set, intervalSet({ version, inclusive: true }, null));
        break;
      case ">":
        set = intersect(set, intervalSet({ version, inclusive: false }, null));
        break;
      case "<=":
        set = intersect(set, intervalSet(null, { version, inclusive: true }));
        break;
      case "<":
        set = intersect(set, intervalSet(null, { version, inclusive: false }));
        break;
      case "=":
        set = intersect(set, singleton(version));
        break;
    }
  }
  return set;
}

export function admitsPrerelease(set: VersionSet, version: Version): boolean {
  return set.intervals.some((interval) =>
    [interval.lower, interval.upper].some(
      (bound) =>
        bound !== null &&
        bound.version.prerelease.length > 0 &&
        bound.version.major === version.major &&
        bound.version.minor === version.minor &&
        bound.version.patch === version.patch,
    ),
  );
}

function formatInterval(interval: Interval): string {
  const { lower, upper } = interval;
  if (lower === null && upper === null) return "*";
  if (
    lower !== null &&
    upper !== null &&
    lower.inclusive &&
    upper.inclusive &&
    compareVersion(lower.version, upper.version) === 0
  ) {
    return formatVersion(lower.version);
  }
  const parts: string[] = [];
  if (lower !== null) {
    parts.push(`${lower.inclusive ? ">=" : ">"}${formatVersion(lower.version)}`);
  }
  if (upper !== null) {
    parts.push(`${upper.inclusive ? "<=" : "<"}${formatVersion(upper.version)}`);
  }
  return parts.join(" ");
}

export function formatSet(set: VersionSet): string {
  if (isEmpty(set)) return "<none>";
  return set.intervals.map(formatInterval).join(" || ");
}
