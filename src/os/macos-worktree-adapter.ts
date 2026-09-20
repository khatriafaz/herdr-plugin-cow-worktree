import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BaseWorktreeOsAdapter } from "./base-worktree-os-adapter.js";

export type CloneFileNative = (source: string, destination: string) => void;

function loadNative(): CloneFileNative {
  const require = createRequire(import.meta.url);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const addon = require(path.resolve(here, "../../build/Release/clonefile.node")) as { cloneFile: CloneFileNative };
  return addon.cloneFile;
}

export class MacOsWorktreeAdapter extends BaseWorktreeOsAdapter {
  readonly platform = "darwin" as const;
  constructor(private readonly nativeCloneFile: CloneFileNative = loadNative()) { super(); }
  protected async cloneRegularFile(source: string, destination: string): Promise<void> {
    this.nativeCloneFile(source, destination);
  }
}
