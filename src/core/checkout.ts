import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PetaError } from "./errors.js";
import { gitCacheDirectory } from "./home.js";
import { readManifestAt } from "./project.js";
import type { DependencySource, ResolvedSource } from "./source.js";
import type { Manifest, ManifestOptions } from "./manifest.js";

export class CheckoutError extends PetaError {}

export type Checkout = {
  readonly directory: string;
  readonly source: ResolvedSource;
  readonly manifest: Manifest;
};

export interface SourceFetcher {
  fetch(source: DependencySource, from: string, root: string): Promise<Checkout>;
}

const DEFAULT_GIT_REFERENCE = "HEAD";

function digestOf(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function git(directory: string, subcommand: string, ...args: string[]): string {
  try {
    return execFileSync("git", [subcommand, ...args], {
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const detail = error instanceof Error ? error.message.split("\n")[0] : String(error);
    throw new CheckoutError(`git ${subcommand} failed: ${detail}`);
  }
}

function pinLineEndings(directory: string): void {
  git(directory, "config", "core.autocrlf", "false");
  git(directory, "config", "core.eol", "lf");
}

function relativeSourcePath(root: string, target: string): string {
  const relative = path.relative(root, target);
  return (relative.length === 0 ? "." : relative).split(path.sep).join("/");
}

export class LocalSourceFetcher implements SourceFetcher {
  constructor(private readonly options: ManifestOptions = {}) {}

  async fetch(source: DependencySource, from: string, root: string): Promise<Checkout> {
    switch (source.kind) {
      case "path":
        return this.fromPath(source.path, from, root);
      case "git":
        return this.fromGit(source.url, source.reference);
      case "registry":
        throw new CheckoutError(
          "registry dependencies need a configured registry; use a path or git source for now",
        );
    }
  }

  private checkoutAt(directory: string, source: ResolvedSource): Checkout {
    return { directory, source, manifest: readManifestAt(directory, this.options) };
  }

  private fromPath(target: string, from: string, root: string): Checkout {
    const directory = path.resolve(from, target);
    if (!fs.existsSync(directory)) {
      throw new CheckoutError(`path dependency '${target}' does not exist (looked in ${directory})`);
    }
    if (!fs.statSync(directory).isDirectory()) {
      throw new CheckoutError(`path dependency '${target}' is not a directory`);
    }
    return this.checkoutAt(directory, {
      kind: "path",
      path: relativeSourcePath(root, directory),
    });
  }

  private fromGit(url: string, reference: string | null): Checkout {
    const wanted = reference ?? DEFAULT_GIT_REFERENCE;
    const directory = path.join(gitCacheDirectory(), `${digestOf(url)}-${digestOf(wanted)}`);
    if (!fs.existsSync(path.join(directory, ".git"))) {
      fs.rmSync(directory, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(directory), { recursive: true });
      git(path.dirname(directory), "clone", "--quiet", "--no-checkout", url, directory);
      pinLineEndings(directory);
      git(directory, "checkout", "--quiet", reference ?? DEFAULT_GIT_REFERENCE);
    }
    const revision = git(directory, "rev-parse", "HEAD");
    return this.checkoutAt(directory, { kind: "git", url, revision });
  }
}
