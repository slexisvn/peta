import { spawnSync } from "node:child_process";
import { loadProject } from "../../core/project.js";
import { UsageError, type CommandSpec } from "../args.js";

export type TaskConfig = {
  readonly command: "task";
  name: string | null;
  args: string[];
  directory: string;
};

export function runTask(config: TaskConfig): number {
  const project = loadProject(config.directory);
  const tasks = project.manifest.tasks;
  if (config.name === null) {
    if (tasks.size === 0) {
      console.log("no tasks defined in tera.json");
      return 0;
    }
    for (const name of [...tasks.keys()].sort()) console.log(`${name}: ${tasks.get(name)}`);
    return 0;
  }
  const command = tasks.get(config.name);
  if (command === undefined) {
    throw new UsageError(`no task named '${config.name}' in tera.json`);
  }
  const line = [command, ...config.args].join(" ");
  console.log(`> ${line}`);
  const result = spawnSync(line, {
    cwd: project.root,
    shell: true,
    stdio: "inherit",
  });
  if (result.error !== undefined) throw new UsageError(result.error.message);
  return result.status ?? 1;
}

export const TASK_COMMAND: CommandSpec<TaskConfig> = {
  name: "task",
  summary: "run a task declared in this project's tera.json",
  arguments: "[name] [args...]",
  flags: [
    {
      name: "directory",
      short: "C",
      value: "dir",
      summary: "run in this directory instead of the current one",
      apply: (config, value) => (config.directory = value),
    },
  ],
  defaults: () => ({ command: "task", name: null, args: [], directory: "." }),
  accept: (config, token) => {
    if (config.name === null) config.name = token;
    else config.args.push(token);
  },
};
