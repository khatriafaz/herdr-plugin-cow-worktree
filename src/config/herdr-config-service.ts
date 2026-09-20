import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface WorktreeDirectoryConfig { directory: string; configuredRelative: boolean; }

export class HerdrConfigService {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env, private readonly home = os.homedir()) {}

  async resolveWorktreeDirectory(): Promise<WorktreeDirectoryConfig> {
    const configPath = this.env.HERDR_CONFIG_PATH ?? path.join(this.home, ".config", "herdr", "config.toml");
    const text = await fs.readFile(configPath, "utf8").catch(() => "");
    const raw = this.readWorktreesDirectory(text) ?? "~/.herdr/worktrees";
    const expanded = raw === "~" ? this.home : raw.startsWith("~/") ? path.join(this.home, raw.slice(2)) : raw;
    const configuredRelative = !path.isAbsolute(expanded);
    return {
      directory: configuredRelative ? path.resolve(path.dirname(configPath), expanded) : path.resolve(expanded),
      configuredRelative,
    };
  }

  private readWorktreesDirectory(text: string): string | undefined {
    let section = "";
    for (const sourceLine of text.split(/\r?\n/)) {
      const line = sourceLine.replace(/\s+#.*$/, "").trim();
      const header = line.match(/^\[([^\]]+)\]$/);
      if (header) { section = header[1]; continue; }
      if (section !== "worktrees") continue;
      const match = line.match(/^directory\s*=\s*["']([^"']+)["']\s*$/);
      if (match) return match[1];
    }
    return undefined;
  }
}
