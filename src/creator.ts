import { HerdrConfigService } from "./config/herdr-config-service.js";
import { CancelledError, AdoptionError } from "./errors.js";
import { GitWorktreeService } from "./git/git-worktree-service.js";
import { HerdrInvocationContext } from "./herdr/context.js";
import { HerdrClient } from "./herdr/herdr-client.js";
import { OsAdapterFactory } from "./os/os-adapter-factory.js";
import { ExecFileCommandRunner } from "./process/command-runner.js";
import { CreateWorktreePrompt } from "./prompt/create-worktree-prompt.js";
import { CreateCowWorktreeUseCase } from "./use-cases/create-cow-worktree-use-case.js";

async function main(): Promise<void> {
  const runner = new ExecFileCommandRunner();
  const herdr = new HerdrClient(runner);
  const useCase = new CreateCowWorktreeUseCase(
    new GitWorktreeService(runner), herdr, new HerdrConfigService(),
    new CreateWorktreePrompt(), new OsAdapterFactory().create());
  const result = await useCase.execute(new HerdrInvocationContext().cwd());
  process.stdout.write(`\nCreated ${result.branch} at ${result.destination}\n`);
  if (result.warnings.length) process.stdout.write(`${result.warnings.join("\n")}\n`);
}

main().catch(async (error: unknown) => {
  if (error instanceof CancelledError) {
    process.stdout.write("\nCancelled.\n");
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`\n${message}\n`);
  const runner = new ExecFileCommandRunner();
  await new HerdrClient(runner).notify(error instanceof AdoptionError ? "Worktree needs adoption" : "CoW worktree failed",
    message, "request");
  process.exitCode = 1;
});
