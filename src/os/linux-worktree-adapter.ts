import { constants, promises as fs } from "node:fs";
import { BaseWorktreeOsAdapter } from "./base-worktree-os-adapter.js";

export class LinuxWorktreeAdapter extends BaseWorktreeOsAdapter {
  readonly platform = "linux" as const;
  constructor(private readonly copyFile: typeof fs.copyFile = fs.copyFile) { super(); }
  protected async cloneRegularFile(source: string, destination: string): Promise<void> {
    await this.copyFile(source, destination, constants.COPYFILE_FICLONE_FORCE);
  }
}
