import { describe, expect, it } from "vitest";
import { HerdrClient } from "../src/herdr/herdr-client.js";
import { AdoptionError } from "../src/errors.js";
import type { CommandRunner } from "../src/process/command-runner.js";

class RecordingRunner implements CommandRunner {
  calls: Array<{ command: string; args: readonly string[] }> = [];
  constructor(private readonly failure?: Error) {}
  async run(command: string, args: readonly string[]) {
    this.calls.push({ command, args });
    if (this.failure) throw this.failure;
    return { stdout: "", stderr: "" };
  }
}

describe("HerdrClient", () => {
  it("opens the creator popup in the selected workspace", async () => {
    const runner = new RecordingRunner();
    await new HerdrClient(runner, "/bin/herdr", "dev.afaz.cow-worktree").openCreatorPopup("w1", "/repo");
    expect(runner.calls[0]?.args).toEqual(["plugin", "pane", "open", "--plugin", "dev.afaz.cow-worktree",
      "--entrypoint", "creator", "--env", "COW_SOURCE_CWD=/repo", "--focus"]);
  });

  it("reports an exact recovery command when adoption fails", async () => {
    const client = new HerdrClient(new RecordingRunner(new Error("offline")), "/bin/herdr");
    const error = await client.adopt("/repo with space", "/trees/it's-here", "feat/x").catch((value) => value);
    expect(error).toBeInstanceOf(AdoptionError);
    expect((error as AdoptionError).recoveryCommand).toContain("'/repo with space'");
    expect((error as AdoptionError).recoveryCommand).toContain("'/trees/it'\"'\"'s-here'");
  });
});
