export class UsageError extends Error {}

export const FLAGS_END = "--";

export interface FlagSpec<C> {
  readonly name: string;
  readonly short?: string;
  readonly value?: string;
  readonly summary: string;
  apply(config: C, value: string): void;
}

export interface CommandSpec<C> {
  readonly name: string;
  readonly summary: string;
  readonly arguments: string;
  readonly flags: readonly FlagSpec<C>[];
  defaults(): C;
  accept(config: C, token: string): void;
}

export type CommandTable<C> = readonly CommandSpec<C>[];

type FlagToken = { readonly name: string; readonly inline: string | null };

function splitFlag(token: string): FlagToken {
  const body = token.startsWith(FLAGS_END) ? token.slice(2) : token.slice(1);
  const equals = body.indexOf("=");
  if (equals < 0) return { name: body, inline: null };
  return { name: body.slice(0, equals), inline: body.slice(equals + 1) };
}

function flagNamed<C>(spec: CommandSpec<C>, token: string, name: string): FlagSpec<C> {
  const flag = spec.flags.find((candidate) => candidate.name === name || candidate.short === name);
  if (flag === undefined) {
    throw new UsageError(`unknown option '${token}' for '${spec.name}' (see 'peta help ${spec.name}')`);
  }
  return flag;
}

function valueOf<C>(
  flag: FlagSpec<C>,
  parsed: FlagToken,
  argv: readonly string[],
  position: number,
): { readonly value: string; readonly consumed: number } {
  if (flag.value === undefined) {
    if (parsed.inline !== null) throw new UsageError(`--${flag.name} does not take a value`);
    return { value: "", consumed: 0 };
  }
  if (parsed.inline !== null) return { value: parsed.inline, consumed: 0 };
  const next = argv[position + 1];
  if (next === undefined) {
    throw new UsageError(`--${flag.name} requires a value (--${flag.name}=<${flag.value}>)`);
  }
  return { value: next, consumed: 1 };
}

export function parseCommand<C>(spec: CommandSpec<C>, argv: readonly string[]): C {
  const config = spec.defaults();
  let literal = false;
  for (let position = 0; position < argv.length; position++) {
    const token = argv[position]!;
    if (literal || !token.startsWith("-") || token.length === 1) {
      spec.accept(config, token);
      continue;
    }
    if (token === FLAGS_END) {
      literal = true;
      continue;
    }
    const parsed = splitFlag(token);
    const flag = flagNamed(spec, token, parsed.name);
    const { value, consumed } = valueOf(flag, parsed, argv, position);
    flag.apply(config, value);
    position += consumed;
  }
  return config;
}

export function commandNamed<C>(table: CommandTable<C>, name: string): CommandSpec<C> | undefined {
  return table.find((command) => command.name === name);
}
