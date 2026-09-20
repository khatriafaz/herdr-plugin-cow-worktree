import { AdoptionError, ValidationError } from "../errors.js";
import type { CommandRunner } from "../process/command-runner.js";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export class HerdrClient {
  constructor(private readonly runner: CommandRunner,
    private readonly binary = process.env.HERDR_BIN_PATH ?? "herdr",
    private readonly pluginId = process.env.HERDR_PLUGIN_ID ?? "dev.afaz.cow-worktree") {}

  async workspaceCwd(workspaceId: string): Promise<string> {
    const workspaceResponse = await this.runner.run(this.binary, ["workspace", "list"]);
    const workspaceParsed = JSON.parse(workspaceResponse.stdout) as { result?: { workspaces?: Array<{
      workspace_id?: string; worktree?: { checkout_path?: string } }> } };
    const checkout = workspaceParsed.result?.workspaces?.find((item) => item.workspace_id === workspaceId)
      ?.worktree?.checkout_path;
    if (checkout) return checkout;
    const paneResponse = await this.runner.run(this.binary, ["pane", "list", "--workspace", workspaceId]);
    const paneParsed = JSON.parse(paneResponse.stdout) as { result?: { panes?: Array<{
      foreground_cwd?: string; cwd?: string }> } };
    const pane = paneParsed.result?.panes?.[0];
    const cwd = pane?.foreground_cwd ?? pane?.cwd;
    if (!cwd) throw new ValidationError(`Could not resolve a checkout path for Herdr workspace ${workspaceId}`);
    return cwd;
  }

  async openCreatorPopup(workspaceId: string | undefined, cwd: string): Promise<void> {
    if (!workspaceId) throw new ValidationError("The CoW creator action requires an active Herdr workspace");
    await this.runner.run(this.binary, ["plugin", "pane", "open", "--plugin", this.pluginId,
      "--entrypoint", "creator", "--env", `COW_SOURCE_CWD=${cwd}`, "--focus"]);
  }

  async adopt(primaryCheckout: string, destination: string, branch: string): Promise<void> {
    const args = ["worktree", "open", "--cwd", primaryCheckout, "--path", destination,
      "--label", branch, "--focus"];
    try {
      await this.runner.run(this.binary, args);
    } catch (cause) {
      const recoveryCommand = [this.binary, ...args].map(shellQuote).join(" ");
      throw new AdoptionError(
        `The Git worktree was created at ${destination}, but Herdr could not adopt it. Run: ${recoveryCommand}`,
        recoveryCommand, { cause });
    }
  }

  async notify(title: string, body: string, sound: "none" | "done" | "request" = "none"): Promise<void> {
    await this.runner.run(this.binary, ["notification", "show", title, "--body", body, "--sound", sound])
      .catch(() => undefined);
  }
}
