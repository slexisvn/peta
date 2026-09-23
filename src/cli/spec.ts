import {
  LOGIN_COMMAND,
  LOGOUT_COMMAND,
  WHOAMI_COMMAND,
  type LoginConfig,
  type LogoutConfig,
  type WhoamiConfig,
} from "./commands/auth.js";
import { CHECK_COMMAND, type CheckConfig } from "./commands/check.js";
import { INIT_COMMAND, type InitConfig } from "./commands/init.js";
import { INSTALL_COMMAND, type InstallConfig } from "./commands/install.js";
import { LIST_COMMAND, WHY_COMMAND, type ListConfig, type WhyConfig } from "./commands/list.js";
import { PACK_COMMAND, type PackConfig } from "./commands/pack.js";
import {
  PUBLISH_COMMAND,
  YANK_COMMAND,
  type PublishConfig,
  type YankConfig,
} from "./commands/publish.js";
import { REMOVE_COMMAND, type RemoveConfig } from "./commands/remove.js";
import { REGISTRY_COMMAND, type RegistryConfig } from "./commands/registry.js";
import { SCOPE_COMMAND, type ScopeConfig } from "./commands/scope.js";
import { SEARCH_COMMAND, type SearchConfig } from "./commands/search.js";
import { TASK_COMMAND, type TaskConfig } from "./commands/task.js";
import { UPDATE_COMMAND, type UpdateConfig } from "./commands/update.js";
import { UsageError, type CommandSpec, type CommandTable } from "./args.js";

export type HelpConfig = {
  readonly command: "help";
  topic: string | null;
};

export type VersionConfig = {
  readonly command: "version";
};

export type PetaConfig =
  | InitConfig
  | InstallConfig
  | RemoveConfig
  | RegistryConfig
  | UpdateConfig
  | ListConfig
  | WhyConfig
  | CheckConfig
  | PackConfig
  | SearchConfig
  | PublishConfig
  | YankConfig
  | LoginConfig
  | LogoutConfig
  | WhoamiConfig
  | ScopeConfig
  | TaskConfig
  | HelpConfig
  | VersionConfig;

function rejectArguments<C>(name: string): (config: C, token: string) => void {
  return (_config, token) => {
    throw new UsageError(`'${name}' takes no arguments, got '${token}'`);
  };
}

export const HELP_COMMAND: CommandSpec<HelpConfig> = {
  name: "help",
  summary: "show help for peta or for one command",
  arguments: "[command]",
  flags: [],
  defaults: () => ({ command: "help", topic: null }),
  accept: (config, token) => (config.topic = token),
};

export const VERSION_COMMAND: CommandSpec<VersionConfig> = {
  name: "version",
  summary: "show the version",
  arguments: "",
  flags: [],
  defaults: () => ({ command: "version" }),
  accept: rejectArguments("version"),
};

export const ALIASES: ReadonlyMap<string, string> = new Map([
  ["add", "install"],
  ["i", "install"],
  ["rm", "remove"],
  ["uninstall", "remove"],
  ["ls", "list"],
  ["run", "task"],
]);

export const COMMANDS: CommandTable<PetaConfig> = [
  INIT_COMMAND,
  INSTALL_COMMAND,
  REMOVE_COMMAND,
  REGISTRY_COMMAND,
  UPDATE_COMMAND,
  LIST_COMMAND,
  WHY_COMMAND,
  CHECK_COMMAND,
  PACK_COMMAND,
  SEARCH_COMMAND,
  PUBLISH_COMMAND,
  YANK_COMMAND,
  LOGIN_COMMAND,
  LOGOUT_COMMAND,
  WHOAMI_COMMAND,
  SCOPE_COMMAND,
  TASK_COMMAND,
  HELP_COMMAND,
  VERSION_COMMAND,
];
