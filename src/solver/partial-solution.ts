import { singleton } from "../core/version-set.js";
import type { Version } from "../core/version.js";
import type { Incompatibility } from "./incompatibility.js";
import {
  intersectTerms,
  positiveTerm,
  relationTo,
  satisfiesTerm,
  type Relation,
  type Term,
} from "./term.js";

export type Assignment = {
  readonly index: number;
  readonly level: number;
  readonly term: Term;
  readonly cause: Incompatibility | null;
  readonly version: Version | null;
};

export class PartialSolution {
  private assignments: Assignment[] = [];
  private derived = new Map<string, Term>();
  private readonly chosen = new Map<string, Version>();
  private level = 0;

  get decisionLevel(): number {
    return this.level;
  }

  get decisions(): ReadonlyMap<string, Version> {
    return this.chosen;
  }

  decide(name: string, version: Version): void {
    this.level += 1;
    this.chosen.set(name, version);
    this.assign({
      index: this.assignments.length,
      level: this.level,
      term: positiveTerm(name, singleton(version)),
      cause: null,
      version,
    });
  }

  derive(term: Term, cause: Incompatibility): void {
    this.assign({
      index: this.assignments.length,
      level: this.level,
      term,
      cause,
      version: null,
    });
  }

  relation(term: Term): Relation {
    const current = this.derived.get(term.package);
    return current === undefined ? "inconclusive" : relationTo(current, term);
  }

  satisfies(term: Term): boolean {
    return this.relation(term) === "satisfied";
  }

  termFor(name: string): Term | undefined {
    return this.derived.get(name);
  }

  decisionFor(name: string): Version | undefined {
    return this.chosen.get(name);
  }

  satisfier(term: Term): Assignment {
    let accumulated: Term | null = null;
    for (const assignment of this.assignments) {
      if (assignment.term.package !== term.package) continue;
      accumulated =
        accumulated === null ? assignment.term : intersectTerms(accumulated, assignment.term);
      if (satisfiesTerm(accumulated, term)) return assignment;
    }
    throw new Error(`'${term.package}' is not satisfied by the partial solution`);
  }

  undecided(): readonly string[] {
    const names: string[] = [];
    for (const [name, term] of this.derived) {
      if (term.positive && !this.chosen.has(name)) names.push(name);
    }
    return names;
  }

  backtrack(level: number): void {
    this.level = level;
    const kept = this.assignments.filter((assignment) => assignment.level <= level);
    this.assignments = kept.map((assignment, index) => ({ ...assignment, index }));
    this.chosen.clear();
    this.derived = new Map();
    for (const assignment of this.assignments) this.record(assignment);
  }

  private assign(assignment: Assignment): void {
    this.assignments.push(assignment);
    this.record(assignment);
  }

  private record(assignment: Assignment): void {
    const name = assignment.term.package;
    if (assignment.version !== null) this.chosen.set(name, assignment.version);
    const current = this.derived.get(name);
    this.derived.set(
      name,
      current === undefined ? assignment.term : intersectTerms(current, assignment.term),
    );
  }
}
