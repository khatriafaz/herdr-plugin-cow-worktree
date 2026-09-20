import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, lstat, mkdtemp, mkdir, readFile, readlink, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ExecFileCommandRunner } from "../src/process/command-runner.js";
import { GitWorktreeService } from "../src/git/git-worktree-service.js";
import { MacOsWorktreeAdapter } from "../src/os/macos-worktree-adapter.js";

const exec = promisify(execFile);
async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await exec("git", args, { cwd, encoding: "utf8" })).stdout;
}

describe.runIf(process.platform === "darwin")("Git + macOS CoW integration", () => {
  it("clones ignored files, preserves links/modes, and isolates writes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "cow-git-"));
    const source = path.join(root, "primary");
    const destination = path.join(root, "trees", "feature");
    await mkdir(source);
    await git(source, "init", "-b", "main");
    await git(source, "config", "user.email", "cow@example.invalid");
    await git(source, "config", "user.name", "CoW Test");
    await writeFile(path.join(source, ".gitignore"), "node_modules/\n.env\n");
    await writeFile(path.join(source, "script.sh"), "#!/bin/sh\necho ok\n");
    await chmod(path.join(source, "script.sh"), 0o755);
    await symlink("script.sh", path.join(source, "script-link"));
    await git(source, "add", ".");
    await git(source, "commit", "-m", "initial");
    await mkdir(path.join(source, "node_modules", "pkg"), { recursive: true });
    await writeFile(path.join(source, "node_modules", "pkg", "index.js"), "source");
    await writeFile(path.join(source, ".env"), "TOKEN=secret\n", { mode: 0o600 });

    const service = new GitWorktreeService(new ExecFileCommandRunner());
    const inspection = await service.inspect(source);
    const handle = await service.createAdministrativeWorktree(inspection, "feature", destination);
    await new MacOsWorktreeAdapter().cloneCheckout({ source, destination, excludedRelativePaths: inspection.allSubmodules });
    await service.installAndRepair(handle);
    await service.verify(handle);

    expect(await readFile(path.join(destination, ".env"), "utf8")).toBe("TOKEN=secret\n");
    expect((await stat(path.join(destination, ".env"))).mode & 0o777).toBe(0o600);
    expect((await stat(path.join(destination, "script.sh"))).mode & 0o777).toBe(0o755);
    expect(await readlink(path.join(destination, "script-link"))).toBe("script.sh");
    await writeFile(path.join(destination, "node_modules", "pkg", "index.js"), "destination");
    expect(await readFile(path.join(source, "node_modules", "pkg", "index.js"), "utf8")).toBe("source");
    expect((await lstat(path.join(destination, ".git"))).isFile()).toBe(true);
    await service.rollback(handle);
  });

  it("mirrors initialized submodules", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "cow-submodule-"));
    const moduleRepo = path.join(root, "module");
    const source = path.join(root, "primary");
    const destination = path.join(root, "trees", "with-module");
    await mkdir(moduleRepo);
    await git(moduleRepo, "init", "-b", "main");
    await git(moduleRepo, "config", "user.email", "cow@example.invalid");
    await git(moduleRepo, "config", "user.name", "CoW Test");
    await writeFile(path.join(moduleRepo, "module.txt"), "module contents\n");
    await git(moduleRepo, "add", ".");
    await git(moduleRepo, "commit", "-m", "module");
    await mkdir(source);
    await git(source, "init", "-b", "main");
    await git(source, "config", "user.email", "cow@example.invalid");
    await git(source, "config", "user.name", "CoW Test");
    await exec("git", ["-c", "protocol.file.allow=always", "submodule", "add", moduleRepo, "vendor/module"], { cwd: source });
    await git(source, "commit", "-am", "add submodule");

    const runner = new ExecFileCommandRunner();
    const service = new GitWorktreeService(runner);
    const inspection = await service.inspect(source);
    expect(inspection.initializedSubmodules).toEqual(["vendor/module"]);
    const handle = await service.createAdministrativeWorktree(inspection, "with-module", destination);
    await new MacOsWorktreeAdapter().cloneCheckout({ source, destination, excludedRelativePaths: inspection.allSubmodules });
    await service.installAndRepair(handle);
    const previousAllowProtocol = process.env.GIT_ALLOW_PROTOCOL;
    process.env.GIT_ALLOW_PROTOCOL = "file";
    try {
      await service.initializeSubmodules(handle, inspection.initializedSubmodules);
    } finally {
      if (previousAllowProtocol === undefined) delete process.env.GIT_ALLOW_PROTOCOL;
      else process.env.GIT_ALLOW_PROTOCOL = previousAllowProtocol;
    }
    await service.verify(handle);
    expect(await readFile(path.join(destination, "vendor", "module", "module.txt"), "utf8"))
      .toBe("module contents\n");
    await service.rollback(handle);
  });
});
