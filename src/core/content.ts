import { PetaError } from "./errors.js";
import { MODULE_EXTENSION } from "./layout.js";

export class ContentError extends PetaError {}

export const DATA_EXTENSIONS: ReadonlySet<string> = new Set([
  ".json",
  ".csv",
  ".tsv",
  ".txt",
  ".md",
  ".ckpt",
  ".tok",
]);

const EXECUTABLE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".wasm",
  ".node",
  ".so",
  ".dll",
  ".dylib",
  ".exe",
  ".c",
  ".h",
  ".py",
  ".sh",
  ".ps1",
  ".bat",
  ".cmd",
]);

export type ContentKind = "source" | "data";

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot).toLowerCase();
}

export function classify(relativePath: string): ContentKind | null {
  const extension = extensionOf(relativePath.split(/[\\/]/).pop() ?? "");
  if (extension === MODULE_EXTENSION) return "source";
  return DATA_EXTENSIONS.has(extension) ? "data" : null;
}

export function rejectionFor(relativePath: string): string {
  const extension = extensionOf(relativePath.split(/[\\/]/).pop() ?? "");
  if (EXECUTABLE_EXTENSIONS.has(extension)) {
    return `'${relativePath}' is host code; a tera package may only contain tera source and declared data`;
  }
  if (extension.length === 0) {
    return `'${relativePath}' has no extension; a tera package may only contain tera source and declared data`;
  }
  return `'${relativePath}' has the unsupported extension '${extension}'; a tera package may only contain tera source and declared data`;
}

export function requireAllowed(relativePath: string): ContentKind {
  const kind = classify(relativePath);
  if (kind === null) throw new ContentError(rejectionFor(relativePath));
  return kind;
}

export function isUnsafePath(relativePath: string): boolean {
  const segments = relativePath.split(/[\\/]/);
  if (segments.some((segment) => segment === ".." || segment.length === 0)) return true;
  return /^([A-Za-z]:|[\\/])/.test(relativePath);
}
