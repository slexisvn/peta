import { PetaError } from "../core/errors.js";
import { compareVersion, isPrerelease, type Version } from "../core/version.js";
import { admitsPrerelease, contains, singleton, type VersionSet } from "../core/version-set.js";
import {
  incompatibility,
  isFailure,
  type Incompatibility,
  type IncompatibilityCause,
} from "./incompatibility.js";
import { PartialSolution, type Assignment } from "./partial-solution.js";
import { explain } from "./report.js";
import {
  differenceTerms,
  invert,
  isEmptyTerm,
  negativeTerm,
  positiveTerm,
  type Term,
} from "./term.js";

export type ProviderDependency = {
  readonly name: string;
  readonly set: VersionSet;
};

export interface PackageProvider {
  versions(name: string): Promise<readonly Version[]>;
  dependencies(name: string, version: Version): Promise<readonly ProviderDependency[]>;
  preferred?(name: string): Version | undefined;
  exists?(name: string): Promise<boolean>;
}

export type SolveRequest = {
  readonly root: string;
  readonly rootVersion: Version;
  readonly provider: PackageProvider;
};

export class SolveFailure extends PetaError {
  constructor(
    message: string,
    readonly incompatibility: Incompatibility,
  ) {
    super(message);
  }
}

const CONFLICT = Symbol("conflict");

type PropagationResult = string | typeof CONFLICT | null;

class Solver {
  private readonly solution = new PartialSolution();
  private readonly byPackage = new Map<string, Incompatibility[]>();
  private readonly versionCache = new Map<string, readonly Version[]>();

  constructor(private readonly request: SolveRequest) {}

  async solve(): Promise<ReadonlyMap<string, Version>> {
    this.add(
      incompatibility(
        [negativeTerm(this.request.root, singleton(this.request.rootVersion))],
        { kind: "root" },
        this.request.root,
      ),
    );
    let next: string | null = this.request.root;
    while (next !== null) {
      this.propagate(next);
      next = await this.chooseVersion();
    }
    const decisions = new Map(this.solution.decisions);
    decisions.delete(this.request.root);
    return decisions;
  }

  private add(target: Incompatibility): void {
    for (const term of target.terms) {
      const list = this.byPackage.get(term.package);
      if (list === undefined) this.byPackage.set(term.package, [target]);
      else list.push(target);
    }
  }

  private propagate(start: string): void {
    const changed: string[] = [start];
    while (changed.length > 0) {
      const name = changed.shift()!;
      const targets = [...(this.byPackage.get(name) ?? [])].reverse();
      for (const target of targets) {
        const result = this.propagateOne(target);
        if (result === null) continue;
        if (result !== CONFLICT) {
          changed.push(result);
          continue;
        }
        const cause = this.resolveConflict(target);
        const derived = this.propagateOne(cause);
        changed.length = 0;
        if (typeof derived === "string") changed.push(derived);
        break;
      }
    }
  }

  private propagateOne(target: Incompatibility): PropagationResult {
    let unsatisfied: Term | null = null;
    for (const term of target.terms) {
      const relation = this.solution.relation(term);
      if (relation === "contradicted") return null;
      if (relation === "inconclusive") {
        if (unsatisfied !== null) return null;
        unsatisfied = term;
      }
    }
    if (unsatisfied === null) return CONFLICT;
    this.solution.derive(invert(unsatisfied), target);
    return unsatisfied.package;
  }

  private resolveConflict(conflict: Incompatibility): Incompatibility {
    let current = conflict;
    let derivedNew = false;
    for (;;) {
      if (isFailure(current, this.request.root)) {
        throw new SolveFailure(explain(current, this.request.root), current);
      }
      let recentTerm: Term | null = null;
      let recentSatisfier: Assignment | null = null;
      let difference: Term | null = null;
      let previousLevel = 1;
      for (const term of current.terms) {
        const satisfier = this.solution.satisfier(term);
        if (recentSatisfier === null) {
          recentTerm = term;
          recentSatisfier = satisfier;
        } else if (recentSatisfier.index < satisfier.index) {
          previousLevel = Math.max(previousLevel, recentSatisfier.level);
          recentTerm = term;
          recentSatisfier = satisfier;
          difference = null;
        } else {
          previousLevel = Math.max(previousLevel, satisfier.level);
        }
        if (recentTerm === term) {
          const remainder = differenceTerms(recentSatisfier.term, recentTerm);
          difference = isEmptyTerm(remainder) ? null : remainder;
          if (difference !== null) {
            previousLevel = Math.max(
              previousLevel,
              this.solution.satisfier(invert(difference)).level,
            );
          }
        }
      }
      const satisfier = recentSatisfier!;
      if (previousLevel < satisfier.level || satisfier.cause === null) {
        this.solution.backtrack(previousLevel);
        if (derivedNew) this.add(current);
        return current;
      }
      const priorCause = satisfier.cause;
      const terms = [
        ...current.terms.filter((term) => term !== recentTerm),
        ...priorCause.terms.filter((term) => term.package !== satisfier.term.package),
      ];
      if (difference !== null) terms.push(invert(difference));
      current = incompatibility(
        terms,
        { kind: "conflict", left: current, right: priorCause },
        this.request.root,
      );
      derivedNew = true;
    }
  }

  private async versionsOf(name: string): Promise<readonly Version[]> {
    const cached = this.versionCache.get(name);
    if (cached !== undefined) return cached;
    const versions = await this.request.provider.versions(name);
    const sorted = [...versions].sort(compareVersion);
    this.versionCache.set(name, sorted);
    return sorted;
  }

  private matching(versions: readonly Version[], set: VersionSet): readonly Version[] {
    return versions.filter(
      (version) =>
        contains(set, version) && (!isPrerelease(version) || admitsPrerelease(set, version)),
    );
  }

  private select(name: string, matches: readonly Version[]): Version {
    const preferred = this.request.provider.preferred?.(name);
    if (preferred !== undefined) {
      const kept = matches.find((version) => compareVersion(version, preferred) === 0);
      if (kept !== undefined) return kept;
    }
    return matches[matches.length - 1]!;
  }

  private async chooseVersion(): Promise<string | null> {
    const undecided = this.solution.undecided();
    if (undecided.length === 0) return null;

    let chosenName: string | null = null;
    let chosenTerm: Term | null = null;
    let chosenMatches: readonly Version[] = [];
    let chosenTotal = 0;
    for (const name of undecided) {
      const term = this.solution.termFor(name)!;
      const all = await this.versionsOf(name);
      const matches = this.matching(all, term.set);
      if (chosenName === null || matches.length < chosenMatches.length) {
        chosenName = name;
        chosenTerm = term;
        chosenMatches = matches;
        chosenTotal = all.length;
      }
      if (matches.length === 0) break;
    }

    const name = chosenName!;
    const term = chosenTerm!;
    if (chosenMatches.length === 0) {
      const known =
        chosenTotal > 0 || ((await this.request.provider.exists?.(name)) ?? false);
      const cause: IncompatibilityCause = known
        ? { kind: "noVersions" }
        : { kind: "unknownPackage", reason: "unknown" };
      this.add(incompatibility([positiveTerm(name, term.set)], cause, this.request.root));
      return name;
    }

    const version = this.select(name, chosenMatches);
    const dependencies = await this.request.provider.dependencies(name, version);
    let conflict = false;
    for (const dependency of dependencies) {
      const target = incompatibility(
        [positiveTerm(name, singleton(version)), negativeTerm(dependency.name, dependency.set)],
        { kind: "dependency" },
        this.request.root,
      );
      this.add(target);
      conflict =
        conflict ||
        target.terms.every(
          (entry) => entry.package === name || this.solution.satisfies(entry),
        );
    }
    if (!conflict) this.solution.decide(name, version);
    return name;
  }
}

export async function solve(request: SolveRequest): Promise<ReadonlyMap<string, Version>> {
  return new Solver(request).solve();
}
