export class CowWorktreeError extends Error {
  constructor(message: string, readonly code: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class UnsupportedPlatformError extends CowWorktreeError {
  constructor(platform: string) {
    super(`CoW Worktree does not support platform ${platform}`, "UNSUPPORTED_PLATFORM");
  }
}

export class ValidationError extends CowWorktreeError {
  constructor(message: string) { super(message, "VALIDATION_ERROR"); }
}

export class CancelledError extends CowWorktreeError {
  constructor() { super("Worktree creation cancelled", "CANCELLED"); }
}

export class CommandError extends CowWorktreeError {
  constructor(readonly command: string, readonly stderr: string, options?: ErrorOptions) {
    super(`${command} failed${stderr.trim() ? `: ${stderr.trim()}` : ""}`, "COMMAND_FAILED", options);
  }
}

export class AdoptionError extends CowWorktreeError {
  constructor(message: string, readonly recoveryCommand: string, options?: ErrorOptions) {
    super(message, "ADOPTION_FAILED", options);
  }
}
