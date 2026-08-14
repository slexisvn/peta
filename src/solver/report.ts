import { formatSet, isFull } from "../core/version-set.js";
import { isFailure, type Incompatibility } from "./incompatibility.js";
import type { Term } from "./term.js";

function subject(term: Term): string {
  return isFull(term.set) ? term.package : `${term.package} ${formatSet(term.set)}`;
}

const requirement = subject;

function joinAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]!}`;
}

function describeTerms(target: Incompatibility): string {
  const terms = target.terms;
  const positives = terms.filter((term) => term.positive);
  const negatives = terms.filter((term) => !term.positive);
  if (terms.length === 1) {
    const only = terms[0]!;
    return only.positive ? `${subject(only)} is forbidden` : `${requirement(only)} is required`;
  }
  if (terms.length === 2 && positives.length === 1 && negatives.length === 1) {
    return `${subject(positives[0]!)} requires ${requirement(negatives[0]!)}`;
  }
  if (negatives.length === 0) {
    return `${joinAnd(positives.map(subject))} are incompatible`;
  }
  if (positives.length === 0) {
    return `one of ${negatives.map(requirement).join(" or ")} is required`;
  }
  return `${joinAnd(positives.map(subject))} require ${joinAnd(negatives.map(requirement))}`;
}

function describe(target: Incompatibility, root: string): string {
  if (isFailure(target, root)) return "version solving failed";
  switch (target.cause.kind) {
    case "root": {
      const only = target.terms[0];
      return only === undefined ? "version solving failed" : `${requirement(only)} is required`;
    }
    case "dependency": {
      const dependant = target.terms.find((term) => term.positive);
      const dependency = target.terms.find((term) => !term.positive);
      if (dependant === undefined || dependency === undefined) return describeTerms(target);
      return `${subject(dependant)} depends on ${requirement(dependency)}`;
    }
    case "noVersions": {
      const only = target.terms[0];
      return only === undefined
        ? "version solving failed"
        : `no versions of ${only.package} match ${formatSet(only.set)}`;
    }
    case "unknownPackage": {
      const only = target.terms[0];
      return only === undefined ? "version solving failed" : `${only.package} does not exist`;
    }
    case "conflict":
      return describeTerms(target);
  }
}

function isDerived(target: Incompatibility): boolean {
  return target.cause.kind === "conflict";
}

class Report {
  private readonly lines: string[] = [];
  private readonly numbers = new Map<number, number>();
  private readonly uses = new Map<number, number>();

  constructor(private readonly root: string) {}

  build(failure: Incompatibility): string {
    this.count(failure);
    this.uses.delete(failure.id);
    this.visit(failure, true);
    return this.lines.join("\n");
  }

  private count(target: Incompatibility): void {
    const seen = this.uses.get(target.id) ?? 0;
    this.uses.set(target.id, seen + 1);
    if (seen > 0 || target.cause.kind !== "conflict") return;
    this.count(target.cause.left);
    this.count(target.cause.right);
  }

  private write(target: Incompatibility, text: string): void {
    if ((this.uses.get(target.id) ?? 0) > 1) {
      const number = this.numbers.size + 1;
      this.numbers.set(target.id, number);
      this.lines.push(`${text} (${number})`);
      return;
    }
    this.lines.push(text);
  }

  private conclude(target: Incompatibility, prefix: string, conclusion: boolean): string {
    const text = describe(target, this.root);
    if (!conclusion) return `${prefix}, ${text}.`;
    return isFailure(target, this.root)
      ? `${prefix}, version solving failed.`
      : `${prefix}, ${text}.`;
  }

  private visit(target: Incompatibility, conclusion = false): void {
    if (target.cause.kind !== "conflict") {
      this.write(target, `${describe(target, this.root)}.`);
      return;
    }
    const { left, right } = target.cause;
    const leftDerived = isDerived(left);
    const rightDerived = isDerived(right);

    if (leftDerived && rightDerived) {
      const leftLine = this.numbers.get(left.id);
      const rightLine = this.numbers.get(right.id);
      if (leftLine !== undefined && rightLine !== undefined) {
        const prefix = `Because ${describe(left, this.root)} (${leftLine}) and ${describe(right, this.root)} (${rightLine})`;
        this.write(target, this.conclude(target, prefix, conclusion));
        return;
      }
      if (leftLine !== undefined || rightLine !== undefined) {
        const numbered = leftLine !== undefined ? left : right;
        const other = leftLine !== undefined ? right : left;
        const line = leftLine ?? rightLine!;
        this.visit(other);
        const prefix = `And because ${describe(numbered, this.root)} (${line})`;
        this.write(target, this.conclude(target, prefix, conclusion));
        return;
      }
      this.visit(left);
      this.visit(right);
      const text = describe(target, this.root);
      this.write(
        target,
        isFailure(target, this.root) && conclusion
          ? "Thus, version solving failed."
          : `Thus, ${text}.`,
      );
      return;
    }

    if (leftDerived || rightDerived) {
      const derived = leftDerived ? left : right;
      const external = leftDerived ? right : left;
      const line = this.numbers.get(derived.id);
      if (line !== undefined) {
        const prefix = `Because ${describe(external, this.root)} and ${describe(derived, this.root)} (${line})`;
        this.write(target, this.conclude(target, prefix, conclusion));
        return;
      }
      this.visit(derived);
      const prefix = `And because ${describe(external, this.root)}`;
      this.write(target, this.conclude(target, prefix, conclusion));
      return;
    }

    const prefix = `Because ${describe(left, this.root)} and ${describe(right, this.root)}`;
    this.write(target, this.conclude(target, prefix, conclusion));
  }
}

export function explain(failure: Incompatibility, root: string): string {
  if (failure.cause.kind !== "conflict") {
    return `${describe(failure, root)}.`;
  }
  return new Report(root).build(failure);
}
