#!/usr/bin/env bun

import { CLI_HELP, runCli } from "./cli";
import { startServer } from "./serve";

const MAIN_USAGE = `Usage:
  roles serve
  roles cli ...

${CLI_HELP}`;

const main = async () => {
  const args = Bun.argv.slice(2);
  const command = args[0];

  if (command === "serve") {
    startServer();
    return 0;
  }

  if (command === "cli") {
    process.env.ROLES_SUPPRESS_LOGS = "1";
    return await runCli(args.slice(1));
  }

  console.error(MAIN_USAGE);
  return 1;
};

const exitCode = await main();
if (exitCode !== 0) {
  process.exit(exitCode);
}
