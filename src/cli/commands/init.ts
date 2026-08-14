import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_MODULES,
  MANIFEST_FILE,
  emptyManifest,
  formatManifest,
  type Manifest,
} from "../../core/manifest.js";
import { parsePackageName, tryParsePackageName, type PackageName } from "../../core/name.js";
import { MODULE_EXTENSION, PACKAGES_DIRECTORY, PACKAGE_INDEX } from "../../core/layout.js";
import { parseVersion } from "../../core/version.js";
import { UsageError, type CommandSpec } from "../args.js";

export type ProjectKind = "app" | "package";

export type InitConfig = {
  readonly command: "init";
  kind: ProjectKind | null;
  name: string | null;
  modules: string;
  directory: string;
};

const KINDS: readonly ProjectKind[] = ["app", "package"];
const APPLICATION_ENTRY = `main${MODULE_EXTENSION}`;
const INITIAL_VERSION = "0.1.0";

const APPLICATION_SOURCE = `fn greet(who: string) -> string:
  return \`hello, \${who}\`

print(greet("world"))
`;

function packageSource(name: PackageName): string {
  return `fn greet(who: string) -> string:
  return \`hello from ${name.text}, \${who}\`
`;
}

function packageReadme(name: PackageName): string {
  const local = name.segments[name.segments.length - 1]!;
  return `# ${name.text}

## Install

\`\`\`bash
peta install ${name.text}
\`\`\`

## Use

\`\`\`tera
import ${name.text}

print(${name.segments[0]!}.${name.segments.slice(1).join(".")}.greet("world"))
\`\`\`

Everything under \`src/\` is ${local}'s public surface; names starting with \`_\` stay private.
`;
}

function manifestFor(kind: ProjectKind, name: PackageName | null, modules: string): Manifest {
  const base = { ...emptyManifest(), modules };
  if (kind === "app" && name === null) return base;
  if (name === null) throw new UsageError("a package needs a name");
  return { ...base, name, version: parseVersion(INITIAL_VERSION) };
}

function writeIfAbsent(target: string, contents: string): boolean {
  if (fs.existsSync(target)) return false;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents, "utf8");
  return true;
}

function ignorePackages(root: string): boolean {
  const target = path.join(root, ".gitignore");
  const entry = `${PACKAGES_DIRECTORY}/`;
  if (!fs.existsSync(target)) return writeIfAbsent(target, `${entry}\n`);
  const current = fs.readFileSync(target, "utf8");
  if (current.split(/\r?\n/).some((line) => line.trim() === entry)) return false;
  fs.appendFileSync(target, current.endsWith("\n") ? `${entry}\n` : `\n${entry}\n`, "utf8");
  return true;
}

function kindFrom(config: InitConfig): ProjectKind {
  if (config.kind !== null) return config.kind;
  if (config.name === null) return "app";
  throw new UsageError(
    `say what to create: 'peta init package ${config.name}' or 'peta init app'`,
  );
}

export function runInit(config: InitConfig): number {
  const kind = kindFrom(config);
  const name = config.name === null ? null : parsePackageName(config.name);
  if (kind === "package" && name === null) {
    throw new UsageError("a package needs a name: peta init package <scope>.<name>");
  }

  const root = path.resolve(config.directory);
  const manifestPath = path.join(root, MANIFEST_FILE);
  if (fs.existsSync(manifestPath)) {
    throw new UsageError(`${MANIFEST_FILE} already exists in ${root}`);
  }
  const manifest = manifestFor(kind, name, config.modules);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(manifestPath, formatManifest(manifest), "utf8");
  const written: string[] = [MANIFEST_FILE];

  const entry = kind === "package" ? PACKAGE_INDEX : APPLICATION_ENTRY;
  const source = kind === "package" ? packageSource(name!) : APPLICATION_SOURCE;
  const entryPath = path.join(root, manifest.modules, entry);
  if (writeIfAbsent(entryPath, source)) written.push(path.relative(root, entryPath));
  if (kind === "package" && writeIfAbsent(path.join(root, "README.md"), packageReadme(name!))) {
    written.push("README.md");
  }
  const ignored = ignorePackages(root);

  for (const file of written) console.log(`created ${file.split(path.sep).join("/")}`);
  if (ignored) console.log("updated .gitignore");
  console.log(
    kind === "package"
      ? `${name!.text} is ready; 'peta publish' when you want it on the registry`
      : `run it with: tera ${path.posix.join(manifest.modules, APPLICATION_ENTRY)}`,
  );
  return 0;
}

export const INIT_COMMAND: CommandSpec<InitConfig> = {
  name: "init",
  summary: "scaffold an application or a package in the current directory",
  arguments: "[app|package] [name]",
  flags: [
    {
      name: "modules",
      value: "dir",
      summary: `directory holding the module tree (default: ${DEFAULT_MODULES})`,
      apply: (config, value) => (config.modules = value),
    },
    {
      name: "directory",
      short: "C",
      value: "dir",
      summary: "create the project in this directory instead of the current one",
      apply: (config, value) => (config.directory = value),
    },
  ],
  defaults: () => ({
    command: "init",
    kind: null,
    name: null,
    modules: DEFAULT_MODULES,
    directory: ".",
  }),
  accept: (config, token) => {
    if (config.kind === null && config.name === null) {
      const kind = KINDS.find((candidate) => candidate === token);
      if (kind !== undefined) {
        config.kind = kind;
        return;
      }
      if (tryParsePackageName(token) === null) {
        throw new UsageError(`expected 'app' or 'package', got '${token}'`);
      }
      config.name = token;
      return;
    }
    if (config.name !== null) throw new UsageError(`init takes at most one name, got '${token}'`);
    config.name = token;
  },
};
