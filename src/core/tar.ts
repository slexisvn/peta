import { PetaError } from "./errors.js";

export class TarError extends PetaError {}

export type TarEntry = {
  readonly path: string;
  readonly contents: Buffer;
};

const BLOCK = 512;
const NAME_LIMIT = 100;
const PREFIX_LIMIT = 155;
const FILE_TYPE = "0";
const FILE_MODE = "0000644";

const FIELDS = {
  name: [0, 100],
  mode: [100, 8],
  uid: [108, 8],
  gid: [116, 8],
  size: [124, 12],
  mtime: [136, 12],
  checksum: [148, 8],
  type: [156, 1],
  magic: [257, 6],
  version: [263, 2],
  prefix: [345, 155],
} as const;

function writeText(block: Buffer, field: readonly [number, number], value: string): void {
  block.write(value, field[0], field[1], "ascii");
}

function writeOctal(block: Buffer, field: readonly [number, number], value: number): void {
  const digits = value.toString(8).padStart(field[1] - 1, "0");
  if (digits.length > field[1] - 1) throw new TarError(`value ${value} does not fit the header`);
  writeText(block, field, `${digits}\0`);
}

function readText(block: Buffer, field: readonly [number, number]): string {
  const raw = block.subarray(field[0], field[0] + field[1]);
  const end = raw.indexOf(0);
  return raw.subarray(0, end < 0 ? raw.length : end).toString("ascii");
}

function readOctal(block: Buffer, field: readonly [number, number]): number {
  const text = readText(block, field).trim();
  return text.length === 0 ? 0 : Number.parseInt(text, 8);
}

function checksumOf(block: Buffer): number {
  let sum = 0;
  for (let at = 0; at < BLOCK; at++) {
    const inChecksum = at >= FIELDS.checksum[0] && at < FIELDS.checksum[0] + FIELDS.checksum[1];
    sum += inChecksum ? 0x20 : block[at]!;
  }
  return sum;
}

function splitPath(target: string): { name: string; prefix: string } {
  if (Buffer.byteLength(target) <= NAME_LIMIT) return { name: target, prefix: "" };
  const cut = target.lastIndexOf("/", PREFIX_LIMIT);
  const name = cut < 0 ? target : target.slice(cut + 1);
  const prefix = cut < 0 ? "" : target.slice(0, cut);
  if (Buffer.byteLength(name) > NAME_LIMIT || Buffer.byteLength(prefix) > PREFIX_LIMIT) {
    throw new TarError(`'${target}' is too long for a tar header`);
  }
  return { name, prefix };
}

function padding(size: number): number {
  const remainder = size % BLOCK;
  return remainder === 0 ? 0 : BLOCK - remainder;
}

function headerFor(entry: TarEntry): Buffer {
  const block = Buffer.alloc(BLOCK);
  const { name, prefix } = splitPath(entry.path);
  writeText(block, FIELDS.name, name);
  writeText(block, FIELDS.mode, `${FILE_MODE}\0`);
  writeOctal(block, FIELDS.uid, 0);
  writeOctal(block, FIELDS.gid, 0);
  writeOctal(block, FIELDS.size, entry.contents.length);
  writeOctal(block, FIELDS.mtime, 0);
  writeText(block, FIELDS.type, FILE_TYPE);
  writeText(block, FIELDS.magic, "ustar\0");
  writeText(block, FIELDS.version, "00");
  writeText(block, FIELDS.prefix, prefix);
  writeText(block, FIELDS.checksum, `${checksumOf(block).toString(8).padStart(6, "0")}\0 `);
  return block;
}

export function packTar(entries: readonly TarEntry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of [...entries].sort((left, right) => (left.path < right.path ? -1 : 1))) {
    blocks.push(headerFor(entry), entry.contents, Buffer.alloc(padding(entry.contents.length)));
  }
  blocks.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(blocks);
}

export function unpackTar(archive: Buffer): readonly TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  while (offset + BLOCK <= archive.length) {
    const header = archive.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break;
    if (readText(header, FIELDS.magic).trimEnd() !== "ustar") {
      throw new TarError("not a ustar archive");
    }
    const declared = readOctal(header, FIELDS.checksum);
    if (declared !== checksumOf(header)) throw new TarError("corrupt tar header checksum");
    const size = readOctal(header, FIELDS.size);
    const type = readText(header, FIELDS.type);
    const prefix = readText(header, FIELDS.prefix);
    const name = readText(header, FIELDS.name);
    offset += BLOCK;
    if (offset + size > archive.length) throw new TarError("truncated tar entry");
    if (type === FILE_TYPE || type === "") {
      entries.push({
        path: prefix.length === 0 ? name : `${prefix}/${name}`,
        contents: Buffer.from(archive.subarray(offset, offset + size)),
      });
    } else if (type !== "5") {
      throw new TarError(`unsupported tar entry type '${type}' for '${name}'`);
    }
    offset += size + padding(size);
  }
  return entries;
}
