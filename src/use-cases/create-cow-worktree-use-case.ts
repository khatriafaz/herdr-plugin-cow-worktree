import path from "node:path";
import { randomBytes } from "node:crypto";
import { ValidationError } from "../errors.js";
import type { HerdrConfigService } from "../config/herdr-config-service.js";
import type { GitWorktreeHandle, GitWorktreeService } from "../git/git-worktree-service.js";
import type { HerdrClient } from "../herdr/herdr-client.js";
import type { WorktreeOsContract } from "../os/types.js";
import type { CreateWorktreePrompt } from "../prompt/create-worktree-prompt.js";

export interface CreateResult { destination: string; branch: string; warnings: string[]; }

export class CreateCowWorktreeUseCase {
  constructor(private readonly git: GitWorktreeService, private readonly herdr: HerdrClient,
    private readonly config: HerdrConfigService, private readonly prompt: CreateWorktreePrompt,
    private readonly adapter: WorktreeOsContract,
    private readonly createName: () => string = CreateCowWorktreeUseCase.defaultName) {}

  async execute(invocationCwd: string): Promise<CreateResult> {
    let handle: GitWorktreeHandle | undefined;
    let completed = false;
    try {
      const inspection = await this.git.inspect(invocationCwd);
      const configured = await this.config.resolveWorktreeDirectory();
      const branch = this.createName();
      const destination = path.join(configured.directory, inspection.repoName, branch);
      await this.prompt.confirm({
        primaryCheckout: inspection.primaryCheckout,
        branch,
        destination,
      });
      await this.git.validateBranch(inspection.primaryCheckout, branch);
      if (this.isInside(destination, inspection.primaryCheckout)
        || this.isInside(inspection.primaryCheckout, destination)) {
        throw new ValidationError("Destination and primary checkout cannot contain one another");
      }
      handle = await this.git.createAdministrativeWorktree(inspection, branch, destination);
      const request = { source: inspection.primaryCheckout, destination,
        excludedRelativePaths: inspection.allSubmodules };
      await this.adapter.validateCapability(request);
      const report = await this.adapter.cloneCheckout(request);
      await this.git.installAndRepair(handle);
      await this.git.initializeSubmodules(handle, inspection.initializedSubmodules);
      await this.git.verify(handle);
      completed = true;
      await this.herdr.adopt(inspection.primaryCheckout, destination, branch);
      const warnings = report.skippedSpecialFiles.map((file) => `Skipped special file: ${file}`);
      if (warnings.length) await this.herdr.notify("CoW worktree created with warnings", warnings.join("\n"), "request");
      else await this.herdr.notify("CoW worktree created", `${branch} → ${destination}`, "done");
      return { destination, branch, warnings };
    } catch (error) {
      if (!completed) await this.git.rollback(handle);
      throw error;
    } finally {
      await this.adapter.cleanup();
    }
  }

  static defaultName(): string {
    const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    return `cow-${date}-${randomBytes(3).toString("hex")}`;
  }

  private isInside(parent: string, child: string): boolean {
    const relative = path.relative(parent, child);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  }
}
