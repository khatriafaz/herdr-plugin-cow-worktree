import { createInterface, type Interface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { CancelledError } from "../errors.js";

export interface ConfirmationDetails { primaryCheckout: string; branch: string; destination: string; }

export class CreateWorktreePrompt {
  constructor(private readonly makeInterface: () => Interface = () => createInterface({ input: stdin, output: stdout })) {}

  async confirm(details: ConfirmationDetails): Promise<void> {
    const prompt = this.makeInterface();
    try {
      stdout.write(`\nCreate copy-on-write worktree\n  Branch: ${details.branch}\n  Path:   ${details.destination}\n  From:   ${details.primaryCheckout}\n\n`);
      stdout.write("Warning: the complete checkout will be cloned, including ignored dependencies and secrets.\n");
      const confirmation = (await prompt.question("Create now? [Y/n]: ")).trim().toLowerCase();
      if (confirmation && confirmation !== "y" && confirmation !== "yes") throw new CancelledError();
    } finally {
      prompt.close();
    }
  }
}
