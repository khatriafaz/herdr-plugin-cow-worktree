import path from "node:path";
import { ValidationError } from "../errors.js";
import type { HerdrConfigService } from "../config/herdr-config-service.js";
import type { GitInspection, GitWorktreeHandle, GitWorktreeService } from "../git/git-worktree-service.js";
import type { HerdrClient } from "../herdr/herdr-client.js";
import type { WorktreeOsContract } from "../os/types.js";
import type { CreateWorktreePrompt } from "../prompt/create-worktree-prompt.js";

export interface CreateResult { destination: string; branch: string; warnings: string[]; }

export class CreateCowWorktreeUseCase {
  constructor(private readonly git: GitWorktreeService, private readonly herdr: HerdrClient,
    private readonly config: HerdrConfigService, private readonly prompt: CreateWorktreePrompt,
    private readonly adapter: WorktreeOsContract) {}

  async execute(invocationCwd: string): Promise<CreateResult> {
    let handle: GitWorktreeHandle | undefined;
    let completed = false;
    try {
      const inspection = await this.git.inspect(invocationCwd);
      const configured = await this.config.resolveWorktreeDirectory();
      const answers = await this.prompt.collect({
        primaryCheckout: inspection.primaryCheckout,
        branchSuggestion: "cow-worktree",
        destinationRoot: configured.directory,
        repoName: inspection.repoName,
        configuredRootWasRelative: configured.configuredRelative,
      });
      await this.git.validateBranch(inspection.primaryCheckout, answers.branch);
      if (this.isInside(answers.destination, inspection.primaryCheckout)
        || this.isInside(inspection.primaryCheckout, answers.destination)) {
        throw new ValidationError("Destination and primary checkout cannot contain one another");
      }
      handle = await this.git.createAdministrativeWorktree(inspection, answers.branch, answers.destination);
      const request = { source: inspection.primaryCheckout, destination: answers.destination,
        excludedRelativePaths: inspection.allSubmodules };
      await this.adapter.validateCapability(request);
      const report = await this.adapter.cloneCheckout(request);
      await this.git.installAndRepair(handle);
      await this.git.initializeSubmodules(handle, inspection.initializedSubmodules);
      await this.git.verify(handle);
      completed = true;
      await this.herdr.adopt(inspection.primaryCheckout, answers.destination, answers.branch);
      const warnings = report.skippedSpecialFiles.map((file) => `Skipped special file: ${file}`);
      if (warnings.length) await this.herdr.notify("CoW worktree created with warnings", warnings.join("\n"), "request");
      else await this.herdr.notify("CoW worktree created", `${answers.branch} → ${answers.destination}`, "done");
      return { destination: answers.destination, branch: answers.branch, warnings };
    } catch (error) {
      if (!completed) await this.git.rollback(handle);
      throw error;
    } finally {
      await this.adapter.cleanup();
    }
  }

  private isInside(parent: string, child: string): boolean {
    const relative = path.relative(parent, child);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  }
}
