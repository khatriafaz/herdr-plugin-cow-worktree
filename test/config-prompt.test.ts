import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HerdrConfigService } from "../src/config/herdr-config-service.js";

describe("HerdrConfigService", () => {
  it("resolves relative worktree roots against the config directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "cow-config-"));
    const config = path.join(root, "nested", "config.toml");
    await mkdir(path.dirname(config), { recursive: true });
    await writeFile(config, "[worktrees]\ndirectory = '../trees'\n");
    const value = await new HerdrConfigService({ HERDR_CONFIG_PATH: config }, root).resolveWorktreeDirectory();
    expect(value.configuredRelative).toBe(true);
    expect(value.directory).toBe(path.join(root, "trees"));
  });
});
