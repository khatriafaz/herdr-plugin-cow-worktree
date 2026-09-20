import { ExecFileCommandRunner } from "./process/command-runner.js";
import { HerdrClient } from "./herdr/herdr-client.js";
import { HerdrInvocationContext } from "./herdr/context.js";

async function main(): Promise<void> {
  const runner = new ExecFileCommandRunner();
  const context = new HerdrInvocationContext();
  const workspaceId = context.workspaceId();
  const herdr = new HerdrClient(runner);
  const cwd = context.explicitCwd() ?? (workspaceId ? await herdr.workspaceCwd(workspaceId) : process.cwd());
  await herdr.openCreatorPopup(workspaceId, cwd);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
