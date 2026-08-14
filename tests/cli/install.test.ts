import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { run } from "../../src/cli/run.js";
import { Sandbox } from "../support/project.js";

let box: Sandbox;
let output: string[];

function app(dependencies: Record<string, unknown>, files?: Record<string, string>): void {
  box.package("app", { dependencies, ...(files === undefined ? {} : { files }) });
}

async function peta(...argv: string[]): Promise<number> {
  return run([...argv, "-C", box.at("app")]);
}

beforeEach(() => {
  box = Sandbox.create("install");
  output = [];
  vi.spyOn(console, "log").mockImplementation((text: unknown) => {
    output.push(String(text));
  });
  vi.spyOn(console, "error").mockImplementation((text: unknown) => {
    output.push(String(text));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  box.remove();
});

describe("peta install with a path dependency", () => {
  it("materialises the package at its import path", async () => {
    box.package("json", {
      name: "slexis.json",
      version: "1.2.0",
      files: { "src/__init__.tera": "fn parse(text): return text\n", "src/writer.tera": "" },
    });
    app({ "slexis.json": { path: "../json" } });

    expect(await peta("install")).toBe(0);
    expect(box.exists("app/tera_packages/slexis/json/__init__.tera")).toBe(true);
    expect(box.exists("app/tera_packages/slexis/json/writer.tera")).toBe(true);
    expect(box.read("app/tera_packages/slexis/json/__init__.tera")).toContain("fn parse");
  });

  it("writes a lockfile naming the resolved version and source", async () => {
    box.package("json", { name: "slexis.json", version: "1.2.0" });
    app({ "slexis.json": { path: "../json" } });

    await peta("install");
    const lock = JSON.parse(box.read("app/tera.lock")) as {
      lockVersion: number;
      packages: Record<string, { version: string; source: string }>;
    };
    expect(lock.lockVersion).toBe(1);
    expect(lock.packages["slexis.json"]).toEqual({
      version: "1.2.0",
      source: "path:../json",
    });
  });

  it("installs transitive path dependencies", async () => {
    box.package("core", { name: "slexis.core", version: "0.1.0" });
    box.package("json", {
      name: "slexis.json",
      version: "1.2.0",
      dependencies: { "slexis.core": { path: "../core" } },
    });
    app({ "slexis.json": { path: "../json" } });

    expect(await peta("install")).toBe(0);
    expect(box.exists("app/tera_packages/slexis/json/__init__.tera")).toBe(true);
    expect(box.exists("app/tera_packages/slexis/core/__init__.tera")).toBe(true);
    expect(box.list("app/tera_packages/slexis")).toEqual(["core", "json"]);
  });

  it("records the dependency edge in the lockfile", async () => {
    box.package("core", { name: "slexis.core", version: "0.1.0" });
    box.package("json", {
      name: "slexis.json",
      version: "1.2.0",
      dependencies: { "slexis.core": { path: "../core" } },
    });
    app({ "slexis.json": { path: "../json" } });

    await peta("install");
    const lock = JSON.parse(box.read("app/tera.lock")) as {
      packages: Record<string, { dependencies?: string[] }>;
    };
    expect(lock.packages["slexis.json"]!.dependencies).toEqual(["slexis.core"]);
    expect(lock.packages["slexis.core"]!.dependencies).toBeUndefined();
  });

  it("honours the package's modules directory", async () => {
    box.package("json", {
      name: "slexis.json",
      modules: "lib",
      files: { "lib/__init__.tera": "x = 1\n" },
    });
    app({ "slexis.json": { path: "../json" } });

    await peta("install");
    expect(box.read("app/tera_packages/slexis/json/__init__.tera")).toBe("x = 1\n");
  });

  it("adds a package to tera.json when named on the command line", async () => {
    box.package("json", { name: "slexis.json", version: "1.2.0" });
    app({});

    expect(await peta("install", "slexis.json", "--path", "../json")).toBe(0);
    const manifest = JSON.parse(box.read("app/tera.json")) as {
      dependencies: Record<string, unknown>;
    };
    expect(manifest.dependencies["slexis.json"]).toEqual({ path: "../json" });
    expect(box.exists("app/tera_packages/slexis/json/__init__.tera")).toBe(true);
  });

  it("accepts the npm-style add alias", async () => {
    box.package("json", { name: "slexis.json" });
    app({});
    expect(await peta("add", "slexis.json", "--path", "../json")).toBe(0);
    expect(box.exists("app/tera_packages/slexis/json/__init__.tera")).toBe(true);
  });
});

describe("peta install refuses bad packages", () => {
  it("rejects host code in a package", async () => {
    box.package("json", {
      name: "slexis.json",
      files: { "src/__init__.tera": "", "src/native.js": "module.exports = {}\n" },
    });
    app({ "slexis.json": { path: "../json" } });

    expect(await peta("install")).toBe(1);
    expect(output.join("\n")).toContain("host code");
    expect(box.exists("app/tera_packages/slexis/json")).toBe(false);
  });

  it("rejects a package whose manifest declares a different name", async () => {
    box.package("json", { name: "other.json" });
    app({ "slexis.json": { path: "../json" } });

    expect(await peta("install")).toBe(1);
    expect(output.join("\n")).toContain("declares 'other.json'");
  });

  it("reports a missing path dependency", async () => {
    app({ "slexis.json": { path: "../nope" } });
    expect(await peta("install")).toBe(1);
    expect(output.join("\n")).toContain("does not exist");
  });

  it("explains an unsatisfiable version requirement", async () => {
    box.package("core", { name: "slexis.core", version: "2.0.0" });
    box.package("json", {
      name: "slexis.json",
      version: "1.0.0",
      dependencies: { "slexis.core": "^1.0.0" },
    });
    app({ "slexis.json": { path: "../json" }, "slexis.core": { path: "../core" } });

    expect(await peta("install")).toBe(1);
    const message = output.join("\n");
    expect(message).toContain("slexis.core");
    expect(message).toContain("version solving failed");
  });
});

describe("peta install --frozen", () => {
  it("passes when the lockfile already matches", async () => {
    box.package("json", { name: "slexis.json" });
    app({ "slexis.json": { path: "../json" } });
    await peta("install");
    expect(await peta("install", "--frozen")).toBe(0);
  });

  it("fails when the lockfile would change", async () => {
    box.package("json", { name: "slexis.json" });
    box.package("core", { name: "slexis.core" });
    app({ "slexis.json": { path: "../json" } });
    await peta("install");
    box.package("app", {
      dependencies: { "slexis.json": { path: "../json" }, "slexis.core": { path: "../core" } },
    });
    expect(await peta("install", "--frozen")).toBe(1);
    expect(output.join("\n")).toContain("out of date");
  });
});

describe("peta remove", () => {
  it("drops the package from tera.json and deletes its tree", async () => {
    box.package("json", { name: "slexis.json" });
    box.package("core", { name: "slexis.core" });
    app({ "slexis.json": { path: "../json" }, "slexis.core": { path: "../core" } });
    await peta("install");

    expect(await peta("remove", "slexis.json")).toBe(0);
    expect(box.exists("app/tera_packages/slexis/json")).toBe(false);
    expect(box.exists("app/tera_packages/slexis/core")).toBe(true);
    const manifest = JSON.parse(box.read("app/tera.json")) as {
      dependencies: Record<string, unknown>;
    };
    expect(Object.keys(manifest.dependencies)).toEqual(["slexis.core"]);
  });

  it("prunes an emptied scope directory", async () => {
    box.package("json", { name: "slexis.json" });
    app({ "slexis.json": { path: "../json" } });
    await peta("install");
    await peta("remove", "slexis.json");
    expect(box.list("app/tera_packages")).toEqual([".peta"]);
  });

  it("refuses to remove something that is not a dependency", async () => {
    app({});
    expect(await peta("remove", "slexis.json")).toBe(2);
  });
});

describe("peta list and why", () => {
  it("marks transitive packages", async () => {
    box.package("core", { name: "slexis.core", version: "0.1.0" });
    box.package("json", {
      name: "slexis.json",
      version: "1.2.0",
      dependencies: { "slexis.core": { path: "../core" } },
    });
    app({ "slexis.json": { path: "../json" } });
    await peta("install");
    output.length = 0;

    expect(await peta("list")).toBe(0);
    const lines = output.filter((line) => line.includes("slexis"));
    expect(lines.find((line) => line.includes("slexis.json"))?.startsWith(" ")).toBe(true);
    expect(lines.find((line) => line.includes("slexis.core"))?.startsWith("-")).toBe(true);
  });

  it("names the dependant that pulled a package in", async () => {
    box.package("core", { name: "slexis.core", version: "0.1.0" });
    box.package("json", {
      name: "slexis.json",
      version: "1.2.0",
      dependencies: { "slexis.core": { path: "../core" } },
    });
    app({ "slexis.json": { path: "../json" } });
    await peta("install");
    output.length = 0;

    expect(await peta("why", "slexis.core")).toBe(0);
    expect(output.join("\n")).toContain("required by slexis.json 1.2.0");
  });
});

describe("peta check", () => {
  it("accepts imports that match a declared dependency", async () => {
    box.package("json", { name: "slexis.json" });
    app(
      { "slexis.json": { path: "../json" } },
      { "src/main.tera": "import slexis.json\n\nprint(1)\n" },
    );
    await peta("install");
    output.length = 0;

    expect(await peta("check")).toBe(0);
  });

  it("flags an import that no dependency provides", async () => {
    app({}, { "src/main.tera": "import acme.http\n" });
    expect(await peta("check")).toBe(1);
    expect(output.join("\n")).toContain("no dependency provides 'acme.http'");
  });

  it("ignores single-segment and local imports", async () => {
    app({}, { "src/main.tera": "import math\nimport util.text\n", "util/text.tera": "" });
    expect(await peta("check")).toBe(0);
  });

  it("ignores imports inside comments", async () => {
    app({}, { "src/main.tera": "# import acme.http\n// import acme.other\n" });
    expect(await peta("check")).toBe(0);
  });

  it("reports a declared dependency that is never imported", async () => {
    box.package("json", { name: "slexis.json" });
    app({ "slexis.json": { path: "../json" } }, { "src/main.tera": "print(1)\n" });
    await peta("install");
    output.length = 0;

    expect(await peta("check")).toBe(0);
    expect(output.join("\n")).toContain("unused: slexis.json");
  });
});

describe("peta task", () => {
  it("lists the declared tasks", async () => {
    box.package("app", { tasks: { greet: "echo hello" } });
    expect(await peta("task")).toBe(0);
    expect(output.join("\n")).toContain("greet: echo hello");
  });

  it("refuses an unknown task", async () => {
    box.package("app", { tasks: { greet: "echo hello" } });
    expect(await peta("task", "missing")).toBe(2);
  });
});
