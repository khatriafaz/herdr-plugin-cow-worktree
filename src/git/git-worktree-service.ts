import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ValidationError } from "../errors.js";
import type { CommandRunner } from "../process/command-runner.js";

export interface GitInspection {
  primaryCheckout: string;
  repoName: string;
  sourceHead: string;
  initializedSubmodules: string[];
  allSubmodules: string[];
}

export interface GitWorktreeHandle {
  primaryCheckout: string;
  adminCheckout: string;
  destination: string;
  branch: string;
  sourceHead: string;
  gitFileContents: string;
  repaired: boolean;
}

export class GitWorktreeService {
  constructor(private readonly runner: CommandRunner, private readonly git = "git") {}

  async inspect(invocationCwd: string): Promise<GitInspection> {
    const primaryCheckout = await this.resolvePrimaryCheckout(invocationCwd);
    await this.assertClean(primaryCheckout);
    const sourceHead = (await this.gitRun(primaryCheckout, ["rev-parse", "HEAD"])).stdout.trim();
    const { initialized, all } = await this.readSubmodules(primaryCheckout);
    return { primaryCheckout, repoName: path.basename(primaryCheckout), sourceHead,
      initializedSubmodules: initialized, allSubmodules: all };
  }

  async resolvePrimaryCheckout(cwd: string): Promise<string> {
    const top = (await this.gitRun(cwd, ["rev-parse", "--show-toplevel"])).stdout.trim();
    const output = (await this.gitRun(top, ["worktree", "list", "--porcelain"])).stdout;
    const first = output.split(/\r?\n/).find((line) => line.startsWith("worktree "));
    if (!first) throw new ValidationError("Git did not report a primary checkout");
    return path.resolve(first.slice("worktree ".length));
  }

  async assertClean(primaryCheckout: string): Promise<void> {
    const status = (await this.gitRun(primaryCheckout,
      ["status", "--porcelain=v1", "--untracked-files=all", "--ignore-submodules=none"])).stdout;
    if (status.trim()) {
      throw new ValidationError("Primary checkout has tracked changes or non-ignored untracked files. Commit, stash, or remove them first.");
    }
  }

  async validateBranch(primaryCheckout: string, branch: string): Promise<void> {
    if (!branch.trim()) throw new ValidationError("Branch name cannot be empty");
    await this.gitRun(primaryCheckout, ["check-ref-format", "--branch", branch]);
    const exists = await this.ref(primaryCheckout, `refs/heads/${branch}`);
    if (exists) throw new ValidationError(`Local branch already exists: ${branch}`);
  }

  async createAdministrativeWorktree(inspection: GitInspection, branch: string, destination: string): Promise<GitWorktreeHandle> {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const adminCheckout = path.join(path.dirname(destination), `.cow-git-${randomUUID()}`);
    await this.gitRun(inspection.primaryCheckout,
      ["worktree", "add", "--no-checkout", "-b", branch, adminCheckout, inspection.sourceHead]);
    const gitFileContents = await fs.readFile(path.join(adminCheckout, ".git"), "utf8");
    await fs.rm(adminCheckout, { recursive: true, force: true });
    return { primaryCheckout: inspection.primaryCheckout, adminCheckout, destination, branch,
      sourceHead: inspection.sourceHead, gitFileContents, repaired: false };
  }

  async installAndRepair(handle: GitWorktreeHandle): Promise<void> {
    await fs.writeFile(path.join(handle.destination, ".git"), handle.gitFileContents, { mode: 0o644, flag: "wx" });
    await this.gitRun(handle.primaryCheckout, ["worktree", "repair", handle.destination]);
    handle.repaired = true;
    await this.gitRun(handle.destination, ["reset", "--mixed", "HEAD"]);
  }

  async initializeSubmodules(handle: GitWorktreeHandle, initializedPaths: readonly string[]): Promise<void> {
    const completed = new Set<string>();
    for (const submodulePath of [...initializedPaths].sort((a, b) => a.split("/").length - b.split("/").length)) {
      const parent = [...completed].filter((candidate) => submodulePath.startsWith(`${candidate}/`))
        .sort((a, b) => b.length - a.length)[0];
      const cwd = parent ? path.join(handle.destination, parent) : handle.destination;
      const relativePath = parent ? submodulePath.slice(parent.length + 1) : submodulePath;
      await this.gitRun(cwd, ["submodule", "update", "--init", "--", relativePath]);
      completed.add(submodulePath);
    }
  }

  async verify(handle: GitWorktreeHandle): Promise<void> {
    const [head, branch, status, sourceHead] = await Promise.all([
      this.gitRun(handle.destination, ["rev-parse", "HEAD"]),
      this.gitRun(handle.destination, ["symbolic-ref", "--short", "HEAD"]),
      this.gitRun(handle.destination, ["status", "--porcelain=v1", "--untracked-files=all", "--ignore-submodules=none"]),
      this.gitRun(handle.primaryCheckout, ["rev-parse", "HEAD"]),
    ]);
    if (head.stdout.trim() !== handle.sourceHead) throw new ValidationError("New worktree HEAD changed during creation");
    if (branch.stdout.trim() !== handle.branch) throw new ValidationError("New worktree is on the wrong branch");
    if (status.stdout.trim()) throw new ValidationError("New worktree is not clean after creation");
    if (sourceHead.stdout.trim() !== handle.sourceHead) throw new ValidationError("Primary checkout HEAD changed during creation");
    await this.assertClean(handle.primaryCheckout);
  }

  async rollback(handle: GitWorktreeHandle | undefined): Promise<void> {
    if (!handle) return;
    const checkout = handle.repaired ? handle.destination : handle.adminCheckout;
    await this.gitRun(handle.primaryCheckout, ["worktree", "remove", "--force", checkout]).catch(() => undefined);
    await fs.rm(handle.destination, { recursive: true, force: true }).catch(() => undefined);
    await fs.rm(handle.adminCheckout, { recursive: true, force: true }).catch(() => undefined);
    await this.gitRun(handle.primaryCheckout, ["worktree", "prune"]).catch(() => undefined);
    const branchHead = await this.ref(handle.primaryCheckout, `refs/heads/${handle.branch}`);
    if (branchHead === handle.sourceHead) {
      await this.gitRun(handle.primaryCheckout, ["branch", "-D", handle.branch]).catch(() => undefined);
    }
  }

  private async readSubmodules(cwd: string): Promise<{ initialized: string[]; all: string[] }> {
    const modulesFile = path.join(cwd, ".gitmodules");
    if (!await fs.access(modulesFile).then(() => true, () => false)) return { initialized: [], all: [] };
    const configured = await this.gitRun(cwd, ["config", "-f", ".gitmodules", "--get-regexp", "path"]).catch(() => ({ stdout: "", stderr: "" }));
    const rootPaths = configured.stdout.split(/\r?\n/).filter(Boolean).map((line) => line.replace(/^\S+\s+/, ""));
    const status = await this.gitRun(cwd, ["submodule", "status", "--recursive"]).catch(() => ({ stdout: "", stderr: "" }));
    const records = status.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
      const match = line.match(/^(.)(?:[0-9a-f]{40,64})\s+(.+?)(?:\s+\(.*\))?$/i);
      return match ? { state: match[1], path: match[2] } : undefined;
    }).filter((value): value is { state: string; path: string } => Boolean(value));
    return {
      initialized: records.filter((record) => record.state !== "-").map((record) => record.path),
      all: [...new Set([...rootPaths, ...records.map((record) => record.path)])],
    };
  }

  private async ref(cwd: string, ref: string): Promise<string | undefined> {
    return this.gitRun(cwd, ["rev-parse", "--verify", ref]).then((result) => result.stdout.trim(), () => undefined);
  }

  private gitRun(cwd: string, args: readonly string[]) { return this.runner.run(this.git, args, { cwd }); }
}
