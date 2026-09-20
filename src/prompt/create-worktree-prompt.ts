import path from "node:path";
import { createInterface, type Interface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { CancelledError, ValidationError } from "../errors.js";

export interface PromptResult { branch: string; destination: string; }
export interface PromptDefaults { primaryCheckout: string; branchSuggestion: string; destinationRoot: string; repoName: string; configuredRootWasRelative: boolean; }

export class CreateWorktreePrompt {
  constructor(private readonly makeInterface: () => Interface = () => createInterface({ input: stdin, output: stdout })) {}

  async collect(defaults: PromptDefaults): Promise<PromptResult> {
    const prompt = this.makeInterface();
    try {
      stdout.write(`\nCreate a copy-on-write worktree from\n  ${defaults.primaryCheckout}\n\n`);
      const branchInput = await prompt.question(`Branch [${defaults.branchSuggestion}]: `);
      const branch = branchInput.trim() || defaults.branchSuggestion;
      const slug = this.slug(branch);
      const defaultDestination = path.join(defaults.destinationRoot, defaults.repoName, slug);
      const destinationInput = await prompt.question(`Destination [${defaultDestination}]: `);
      const destination = destinationInput.trim() || defaultDestination;
      if (!path.isAbsolute(destination)) {
        const reason = defaults.configuredRootWasRelative ? " because Herdr's configured worktree root is relative" : "";
        throw new ValidationError(`Destination must be an absolute path${reason}`);
      }
      stdout.write("\nWarning: this clones the complete checkout, including ignored dependencies and secrets.\n");
      const confirmation = (await prompt.question("Continue? [y/N]: ")).trim().toLowerCase();
      if (confirmation !== "y" && confirmation !== "yes") throw new CancelledError();
      return { branch, destination: path.resolve(destination) };
    } finally {
      prompt.close();
    }
  }

  slug(branch: string): string {
    return branch.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "worktree";
  }
}
