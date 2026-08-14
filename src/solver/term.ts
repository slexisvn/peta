import {
  complement,
  difference as setDifference,
  formatSet,
  intersect,
  isEmpty,
  isFull,
  isSubset,
  union,
  type VersionSet,
} from "../core/version-set.js";

export type Term = {
  readonly package: string;
  readonly set: VersionSet;
  readonly positive: boolean;
};

export type Relation = "satisfied" | "contradicted" | "inconclusive";

export function positiveTerm(name: string, set: VersionSet): Term {
  return { package: name, set, positive: true };
}

export function negativeTerm(name: string, set: VersionSet): Term {
  return { package: name, set, positive: false };
}

export function invert(term: Term): Term {
  return { package: term.package, set: term.set, positive: !term.positive };
}

export function allowed(term: Term): VersionSet {
  return term.positive ? term.set : complement(term.set);
}

export function isEmptyTerm(term: Term): boolean {
  return isEmpty(allowed(term));
}

export function intersectTerms(left: Term, right: Term): Term {
  if (left.positive && right.positive) {
    return positiveTerm(left.package, intersect(left.set, right.set));
  }
  if (!left.positive && !right.positive) {
    return negativeTerm(left.package, union(left.set, right.set));
  }
  const [positive, negative] = left.positive ? [left, right] : [right, left];
  return positiveTerm(left.package, setDifference(positive.set, negative.set));
}

export function differenceTerms(left: Term, right: Term): Term {
  return intersectTerms(left, invert(right));
}

export function satisfiesTerm(left: Term, right: Term): boolean {
  return isSubset(allowed(left), allowed(right));
}

export function relationTo(term: Term, other: Term): Relation {
  const here = allowed(term);
  const there = allowed(other);
  if (isSubset(here, there)) return "satisfied";
  if (isEmpty(intersect(here, there))) return "contradicted";
  return "inconclusive";
}
