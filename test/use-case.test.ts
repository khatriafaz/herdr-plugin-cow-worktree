import { describe, expect, it, vi } from "vitest";
import { AdoptionError } from "../src/errors.js";
import { CreateCowWorktreeUseCase } from "../src/use-cases/create-cow-worktree-use-case.js";

function dependencies(options: { cloneFailure?: Error; adoptionFailure?: Error; submoduleFailure?: Error } = {}) {
  const inspection = { primaryCheckout: "/repo", repoName: "repo", sourceHead: "abc",
    initializedSubmodules: [], allSubmodules: [] };
  const handle = { primaryCheckout: "/repo", adminCheckout: "/trees/.admin", destination: "/trees/feature",
    branch: "feature", sourceHead: "abc", gitFileContents: "gitdir: x", repaired: false };
  const git = {
    inspect: vi.fn().mockResolvedValue(inspection), validateBranch: vi.fn(),
    createAdministrativeWorktree: vi.fn().mockResolvedValue(handle), installAndRepair: vi.fn(),
    initializeSubmodules: options.submoduleFailure ? vi.fn().mockRejectedValue(options.submoduleFailure) : vi.fn(),
    verify: vi.fn(), rollback: vi.fn(),
  };
  const herdr = {
    adopt: options.adoptionFailure ? vi.fn().mockRejectedValue(options.adoptionFailure) : vi.fn(),
    notify: vi.fn(),
  };
  const config = { resolveWorktreeDirectory: vi.fn().mockResolvedValue({ directory: "/trees", configuredRelative: false }) };
  const prompt = { confirm: vi.fn() };
  const adapter = {
    platform: "linux", validateCapability: vi.fn(),
    cloneCheckout: options.cloneFailure ? vi.fn().mockRejectedValue(options.cloneFailure)
      : vi.fn().mockResolvedValue({ destination: "/trees/feature", filesCloned: 1, directoriesCreated: 1,
        symlinksCreated: 0, skippedSpecialFiles: [] }),
    cleanup: vi.fn(),
  };
  const useCase = new CreateCowWorktreeUseCase(git as never, herdr as never, config as never, prompt as never,
    adapter as never, () => "feature");
  return { useCase, git, herdr, adapter, handle };
}

describe("CreateCowWorktreeUseCase", () => {
  it("generates short, filesystem-safe branch names", () => {
    expect(CreateCowWorktreeUseCase.defaultName()).toMatch(/^cow-\d{8}-[0-9a-f]{6}$/);
  });

  it("rolls back Git and adapter resources when cloning fails", async () => {
    const deps = dependencies({ cloneFailure: new Error("no reflink") });
    await expect(deps.useCase.execute("/repo")).rejects.toThrow("no reflink");
    expect(deps.git.rollback).toHaveBeenCalledWith(deps.handle);
    expect(deps.adapter.cleanup).toHaveBeenCalledOnce();
  });

  it("retains a completed worktree when only Herdr adoption fails", async () => {
    const failure = new AdoptionError("adopt failed", "herdr worktree open");
    const deps = dependencies({ adoptionFailure: failure });
    await expect(deps.useCase.execute("/repo")).rejects.toBe(failure);
    expect(deps.git.verify).toHaveBeenCalledOnce();
    expect(deps.git.rollback).not.toHaveBeenCalled();
    expect(deps.adapter.cleanup).toHaveBeenCalledOnce();
  });

  it("rolls back the complete operation when submodule initialization fails", async () => {
    const deps = dependencies({ submoduleFailure: new Error("submodule checkout failed") });
    await expect(deps.useCase.execute("/repo")).rejects.toThrow("submodule checkout failed");
    expect(deps.git.rollback).toHaveBeenCalledWith(deps.handle);
    expect(deps.git.verify).not.toHaveBeenCalled();
  });
});
