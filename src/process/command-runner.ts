import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CommandError } from "../errors.js";

const execFileAsync = promisify(execFile);

export interface CommandResult { stdout: string; stderr: string; }
export interface CommandRunner {
  run(command: string, args: readonly string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv }): Promise<CommandResult>;
}

export class ExecFileCommandRunner implements CommandRunner {
  async run(command: string, args: readonly string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<CommandResult> {
    try {
      const result = await execFileAsync(command, [...args], {
        cwd: options.cwd,
        env: options.env,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      });
      return { stdout: result.stdout, stderr: result.stderr };
    } catch (cause) {
      const error = cause as NodeJS.ErrnoException & { stderr?: string };
      throw new CommandError([command, ...args].join(" "), error.stderr ?? error.message, { cause });
    }
  }
}
