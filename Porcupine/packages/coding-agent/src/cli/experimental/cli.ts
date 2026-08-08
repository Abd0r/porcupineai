import { type ClientCommandContext, clientCommand } from "./commands/client.ts";
import { type PorcupineCommandContext, porcupineCommand } from "./commands/porcupine.ts";
import { type ServerCommandContext, serverCommand } from "./commands/server.ts";

export type ExperimentalCliContext = PorcupineCommandContext & ServerCommandContext & ClientCommandContext;

export const experimentalCli = porcupineCommand.command(serverCommand).command(clientCommand);
