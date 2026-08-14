import { COMMANDS } from "./spec.js";
import type { CommandSpec } from "./args.js";

const BINARY = "peta";

function pad(text: string, width: number): string {
  return text.length >= width ? text : `${text}${" ".repeat(width - text.length)}`;
}

function widestOf(entries: readonly string[]): number {
  return entries.reduce((widest, entry) => Math.max(widest, entry.length), 0);
}

function commandLines(): string[] {
  const names = COMMANDS.map((command) => command.name);
  const width = widestOf(names);
  return COMMANDS.map((command) => `  ${pad(command.name, width)}  ${command.summary}`);
}

function flagLines<C>(command: CommandSpec<C>): string[] {
  if (command.flags.length === 0) return [];
  const labels = command.flags.map((flag) => {
    const short = flag.short === undefined ? "" : `-${flag.short}, `;
    const value = flag.value === undefined ? "" : `=<${flag.value}>`;
    return `${short}--${flag.name}${value}`;
  });
  const width = widestOf(labels);
  return [
    "",
    "Options:",
    ...command.flags.map((flag, at) => `  ${pad(labels[at]!, width)}  ${flag.summary}`),
  ];
}

function usageOf<C>(command: CommandSpec<C>): string {
  const args = command.arguments.length === 0 ? "" : ` ${command.arguments}`;
  return `${BINARY} ${command.name}${args}`;
}

export function helpFor(topic: string | null): string {
  const command = topic === null ? undefined : COMMANDS.find((entry) => entry.name === topic);
  if (command !== undefined) {
    return [`Usage: ${usageOf(command)}`, "", command.summary, ...flagLines(command)].join("\n");
  }
  return [
    `Usage: ${BINARY} <command> [options]`,
    "",
    "Commands:",
    ...commandLines(),
    "",
    `Run '${BINARY} help <command>' for details.`,
  ].join("\n");
}
