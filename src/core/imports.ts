import fs from "node:fs";
import path from "node:path";
import { MODULE_EXTENSION, PACKAGES_DIRECTORY } from "./layout.js";

export type ImportSite = {
  readonly file: string;
  readonly line: number;
  readonly path: readonly string[];
};

const COMMENT_PREFIXES = ["#", "//"];
const DOTTED = "[a-z][a-z0-9_]*(?:\\.[a-z][a-z0-9_]*)*";
const IMPORT_PATTERN = new RegExp(`^\\s*import\\s+(${DOTTED}(?:\\s*,\\s*${DOTTED})*)`);
const FROM_PATTERN = new RegExp(`^\\s*from\\s+(${DOTTED})\\s+import\\b`);

function isComment(line: string): boolean {
  const trimmed = line.trimStart();
  return COMMENT_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

function pathsIn(line: string): readonly string[] {
  if (isComment(line)) return [];
  const from = FROM_PATTERN.exec(line);
  if (from !== null) return [from[1]!];
  const plain = IMPORT_PATTERN.exec(line);
  if (plain === null) return [];
  return plain[1]!.split(",").map((part) => part.trim());
}

export function importsIn(source: string, file: string): readonly ImportSite[] {
  const sites: ImportSite[] = [];
  source.split(/\r?\n/).forEach((line, at) => {
    for (const dotted of pathsIn(line)) {
      sites.push({ file, line: at + 1, path: dotted.split(".") });
    }
  });
  return sites;
}

export function sourceFilesIn(root: string): readonly string[] {
  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === PACKAGES_DIRECTORY || entry.name.startsWith(".")) continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(target);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(MODULE_EXTENSION)) files.push(target);
    }
  };
  if (fs.existsSync(root)) walk(root);
  return files.sort();
}

export function projectImports(root: string): readonly ImportSite[] {
  return sourceFilesIn(root).flatMap((file) =>
    importsIn(fs.readFileSync(file, "utf8"), path.relative(root, file)),
  );
}

export function resolvesLocally(root: string, segment: string): boolean {
  return (
    fs.existsSync(path.join(root, segment)) ||
    fs.existsSync(path.join(root, `${segment}${MODULE_EXTENSION}`))
  );
}
