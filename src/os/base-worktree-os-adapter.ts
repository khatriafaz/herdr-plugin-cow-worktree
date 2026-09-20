import { constants, promises as fs, type Stats } from "node:fs";
import path from "node:path";
import { ValidationError } from "../errors.js";
import type { CloneReport, CloneRequest, WorktreeOsContract } from "./types.js";

const normalizeRelative = (value: string) => value.split(path.sep).join("/").replace(/^\.\//, "").replace(/\/$/, "");

export abstract class BaseWorktreeOsAdapter implements WorktreeOsContract {
  abstract readonly platform: "darwin" | "linux";
  private ownedStaging = new Set<string>();

  async validateCapability(request: CloneRequest): Promise<void> {
    if (!path.isAbsolute(request.source) || !path.isAbsolute(request.destination)) {
      throw new ValidationError("Source and destination must be absolute paths");
    }
    const source = await fs.stat(request.source).catch(() => undefined);
    if (!source?.isDirectory()) throw new ValidationError(`Source is not a directory: ${request.source}`);
    if (path.resolve(request.source) === path.resolve(request.destination)) {
      throw new ValidationError("Source and destination must be different");
    }
    await fs.access(path.dirname(request.destination), constants.W_OK);
    if (await fs.lstat(request.destination).then(() => true, () => false)) {
      throw new ValidationError(`Destination already exists: ${request.destination}`);
    }
  }

  async cloneCheckout(request: CloneRequest): Promise<CloneReport> {
    await this.validateCapability(request);
    const parent = path.dirname(request.destination);
    const staging = await fs.mkdtemp(path.join(parent, `.${path.basename(request.destination)}.cow-staging-`));
    this.ownedStaging.add(staging);
    const excluded = new Set((request.excludedRelativePaths ?? []).map(normalizeRelative));
    excluded.add(".git");
    if (this.isInside(request.source, staging)) excluded.add(normalizeRelative(path.relative(request.source, staging)));
    const report: CloneReport = {
      destination: request.destination,
      filesCloned: 0,
      directoriesCreated: 1,
      symlinksCreated: 0,
      skippedSpecialFiles: [],
    };
    try {
      await this.copyDirectoryContents(request.source, staging, "", excluded, report);
      const rootStat = await fs.stat(request.source);
      await this.applyDirectoryMetadata(staging, rootStat);
      await fs.rename(staging, request.destination);
      this.ownedStaging.delete(staging);
      return report;
    } catch (error) {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
      this.ownedStaging.delete(staging);
      throw error;
    }
  }

  async cleanup(): Promise<void> {
    await Promise.all([...this.ownedStaging].map((entry) => fs.rm(entry, { recursive: true, force: true })));
    this.ownedStaging.clear();
  }

  protected abstract cloneRegularFile(source: string, destination: string): Promise<void>;

  private async copyDirectoryContents(sourceRoot: string, destinationRoot: string, relative: string,
    excluded: Set<string>, report: CloneReport): Promise<void> {
    const sourceDirectory = path.join(sourceRoot, relative);
    const entries = await fs.readdir(sourceDirectory, { withFileTypes: true });
    for (const entry of entries) {
      const childRelative = normalizeRelative(path.join(relative, entry.name));
      if (this.isExcluded(childRelative, excluded)) continue;
      const source = path.join(sourceRoot, childRelative);
      const destination = path.join(destinationRoot, childRelative);
      const stat = await fs.lstat(source);
      if (stat.isDirectory()) {
        await fs.mkdir(destination, { mode: stat.mode });
        report.directoriesCreated += 1;
        await this.copyDirectoryContents(sourceRoot, destinationRoot, childRelative, excluded, report);
        await this.applyDirectoryMetadata(destination, stat);
      } else if (stat.isSymbolicLink()) {
        await fs.symlink(await fs.readlink(source), destination);
        if (fs.lutimes) await fs.lutimes(destination, stat.atime, stat.mtime).catch(() => undefined);
        report.symlinksCreated += 1;
      } else if (stat.isFile()) {
        await this.cloneRegularFile(source, destination);
        await fs.chmod(destination, stat.mode);
        await fs.utimes(destination, stat.atime, stat.mtime);
        report.filesCloned += 1;
      } else {
        report.skippedSpecialFiles.push(childRelative);
      }
    }
  }

  private async applyDirectoryMetadata(destination: string, stat: Stats): Promise<void> {
    await fs.chmod(destination, stat.mode);
    await fs.utimes(destination, stat.atime, stat.mtime);
  }

  private isExcluded(relative: string, excluded: Set<string>): boolean {
    for (const item of excluded) if (relative === item || relative.startsWith(`${item}/`)) return true;
    return false;
  }

  private isInside(parent: string, child: string): boolean {
    const relative = path.relative(parent, child);
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
  }
}
