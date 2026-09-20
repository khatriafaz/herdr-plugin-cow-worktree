import { chmod, lstat, mkdtemp, mkdir, readFile, readlink, stat, symlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BaseWorktreeOsAdapter } from "../src/os/base-worktree-os-adapter.js";
import { MacOsWorktreeAdapter } from "../src/os/macos-worktree-adapter.js";
import { LinuxWorktreeAdapter } from "../src/os/linux-worktree-adapter.js";
import { OsAdapterFactory } from "../src/os/os-adapter-factory.js";
import { UnsupportedPlatformError } from "../src/errors.js";

class FakeAdapter extends BaseWorktreeOsAdapter {
  readonly platform = "linux" as const;
  protected async cloneRegularFile(source: string, destination: string): Promise<void> {
    await writeFile(destination, await readFile(source));
  }
}

describe("BaseWorktreeOsAdapter", () => {
  it("recreates contents and metadata while excluding Git and submodules", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "cow-base-"));
    const source = path.join(root, "source");
    const destination = path.join(root, "destination");
    await mkdir(path.join(source, "nested"), { recursive: true });
    await mkdir(path.join(source, ".git"));
    await mkdir(path.join(source, "vendor", "sub"), { recursive: true });
    await writeFile(path.join(source, "nested", "run"), "hello");
    await chmod(path.join(source, "nested", "run"), 0o751);
    await writeFile(path.join(source, ".git", "secret"), "no");
    await writeFile(path.join(source, "vendor", "sub", "tracked"), "no");
    await symlink("nested/run", path.join(source, "link"));
    const report = await new FakeAdapter().cloneCheckout({ source, destination, excludedRelativePaths: ["vendor/sub"] });
    expect(await readFile(path.join(destination, "nested", "run"), "utf8")).toBe("hello");
    expect((await stat(path.join(destination, "nested", "run"))).mode & 0o777).toBe(0o751);
    expect(await readlink(path.join(destination, "link"))).toBe("nested/run");
    expect(await lstat(path.join(destination, ".git")).then(() => true, () => false)).toBe(false);
    expect(await lstat(path.join(destination, "vendor", "sub")).then(() => true, () => false)).toBe(false);
    expect(report.filesCloned).toBe(1);
    expect(report.symlinksCreated).toBe(1);
  });

  it("skips special files and reports them", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "cow-special-"));
    const source = path.join(root, "source");
    const destination = path.join(root, "destination");
    await mkdir(source);
    await promisify(execFile)("mkfifo", [path.join(source, "events.fifo")]);
    const report = await new FakeAdapter().cloneCheckout({ source, destination });
    expect(report.skippedSpecialFiles).toEqual(["events.fifo"]);
    expect(await lstat(path.join(destination, "events.fifo")).then(() => true, () => false)).toBe(false);
  });

  it("removes staging state when strict cloning fails", async () => {
    class FailingAdapter extends FakeAdapter {
      protected async cloneRegularFile(): Promise<void> { throw new Error("reflink unsupported"); }
    }
    const root = await mkdtemp(path.join(os.tmpdir(), "cow-fail-"));
    const source = path.join(root, "source");
    await mkdir(source);
    await writeFile(path.join(source, "file"), "x");
    await expect(new FailingAdapter().cloneCheckout({ source, destination: path.join(root, "dest") }))
      .rejects.toThrow("reflink unsupported");
    await expect((await import("node:fs/promises")).readdir(root).then((names) => names.sort())).resolves.toEqual(["source"]);
  });
});

describe("strict adapters and factory", () => {
  it("propagates native clonefile failures without fallback", async () => {
    const clone = vi.fn(() => { throw new Error("EXDEV"); });
    const adapter = new MacOsWorktreeAdapter(clone);
    const root = await mkdtemp(path.join(os.tmpdir(), "cow-mac-"));
    const source = path.join(root, "source");
    await mkdir(source);
    await writeFile(path.join(source, "file"), "x");
    await expect(adapter.cloneCheckout({ source, destination: path.join(root, "dest") })).rejects.toThrow("EXDEV");
    expect(clone).toHaveBeenCalledOnce();
  });

  it("forces Linux reflinks and propagates unsupported-filesystem errors", async () => {
    const copy = vi.fn(async () => { throw new Error("ENOTSUP"); });
    const adapter = new LinuxWorktreeAdapter(copy as never);
    const root = await mkdtemp(path.join(os.tmpdir(), "cow-linux-"));
    const source = path.join(root, "source");
    await mkdir(source);
    await writeFile(path.join(source, "file"), "x");
    await expect(adapter.cloneCheckout({ source, destination: path.join(root, "dest") })).rejects.toThrow("ENOTSUP");
    expect(copy.mock.calls[0]?.[2]).toBe((await import("node:fs")).constants.COPYFILE_FICLONE_FORCE);
  });

  it("selects injected implementations and rejects other platforms", () => {
    const linux = new FakeAdapter();
    const darwin = new FakeAdapter();
    expect(new OsAdapterFactory("linux", { linux: () => linux, darwin: () => darwin }).create()).toBe(linux);
    expect(new OsAdapterFactory("darwin", { linux: () => linux, darwin: () => darwin }).create()).toBe(darwin);
    expect(() => new OsAdapterFactory("win32", { linux: () => linux, darwin: () => darwin }).create())
      .toThrow(UnsupportedPlatformError);
  });
});
