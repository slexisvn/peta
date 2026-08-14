import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { HOME_VARIABLE } from "../../src/core/home.js";
import { run } from "../../src/cli/run.js";
import { Sandbox } from "../support/project.js";

let box: Sandbox;
let output: string[];
let previousHome: string | undefined;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function commitAll(directory: string, message: string): string {
  git(directory, "add", "-A");
  git(
    directory,
    "-c",
    "user.name=peta",
    "-c",
    "user.email=peta@example.com",
    "commit",
    "-q",
    "-m",
    message,
  );
  return git(directory, "rev-parse", "HEAD");
}

function url(directory: string): string {
  return directory.split("\\").join("/");
}

beforeEach(() => {
  box = Sandbox.create("git");
  output = [];
  previousHome = process.env[HOME_VARIABLE];
  process.env[HOME_VARIABLE] = box.at("home");
  vi.spyOn(console, "log").mockImplementation((text: unknown) => {
    output.push(String(text));
  });
  vi.spyOn(console, "error").mockImplementation((text: unknown) => {
    output.push(String(text));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (previousHome === undefined) delete process.env[HOME_VARIABLE];
  else process.env[HOME_VARIABLE] = previousHome;
  box.remove();
});

describe("peta install with a git dependency", () => {
  it("clones the repository and installs the package", async () => {
    const repository = box.package("repo", {
      name: "slexis.json",
      version: "1.2.0",
      files: { "src/__init__.tera": "fn parse(text): return text\n" },
    });
    git(repository, "init", "-q");
    const revision = commitAll(repository, "initial");

    box.package("app", { dependencies: { "slexis.json": { git: url(repository) } } });
    expect(await run(["install", "-C", box.at("app")])).toBe(0);

    expect(box.exists("app/tera_packages/slexis/json/__init__.tera")).toBe(true);
    const lock = JSON.parse(box.read("app/tera.lock")) as {
      packages: Record<string, { source: string }>;
    };
    expect(lock.packages["slexis.json"]!.source).toBe(`git+${url(repository)}#${revision}`);
  });

  it("checks out the requested revision", async () => {
    const repository = box.package("repo", {
      name: "slexis.json",
      version: "1.0.0",
      files: { "src/__init__.tera": "first\n" },
    });
    git(repository, "init", "-q");
    const first = commitAll(repository, "first");
    box.package("repo", {
      name: "slexis.json",
      version: "2.0.0",
      files: { "src/__init__.tera": "second\n" },
    });
    commitAll(repository, "second");

    box.package("app", {
      dependencies: { "slexis.json": { git: url(repository), rev: first } },
    });
    expect(await run(["install", "-C", box.at("app")])).toBe(0);
    expect(box.read("app/tera_packages/slexis/json/__init__.tera")).toBe("first\n");

    const lock = JSON.parse(box.read("app/tera.lock")) as {
      packages: Record<string, { version: string; source: string }>;
    };
    expect(lock.packages["slexis.json"]!.version).toBe("1.0.0");
    expect(lock.packages["slexis.json"]!.source.endsWith(`#${first}`)).toBe(true);
  });

  it("reports a repository that cannot be cloned", async () => {
    box.package("app", { dependencies: { "slexis.json": { git: url(box.at("missing")) } } });
    expect(await run(["install", "-C", box.at("app")])).toBe(1);
    expect(output.join("\n")).toContain("git clone failed");
  });
});
