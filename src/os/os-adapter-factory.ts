import { UnsupportedPlatformError } from "../errors.js";
import { LinuxWorktreeAdapter } from "./linux-worktree-adapter.js";
import { MacOsWorktreeAdapter } from "./macos-worktree-adapter.js";
import type { WorktreeOsContract } from "./types.js";

export interface AdapterConstructors {
  darwin: () => WorktreeOsContract;
  linux: () => WorktreeOsContract;
}

export class OsAdapterFactory {
  constructor(private readonly platform: NodeJS.Platform = process.platform,
    private readonly constructors: AdapterConstructors = {
      darwin: () => new MacOsWorktreeAdapter(),
      linux: () => new LinuxWorktreeAdapter(),
    }) {}

  create(): WorktreeOsContract {
    if (this.platform === "darwin") return this.constructors.darwin();
    if (this.platform === "linux") return this.constructors.linux();
    throw new UnsupportedPlatformError(this.platform);
  }
}
