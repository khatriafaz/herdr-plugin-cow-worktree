import { spawnSync } from "node:child_process";

if (process.platform !== "darwin") {
  process.stdout.write("Skipping the macOS clonefile helper on this platform.\n");
  process.exit(0);
}

const command = process.platform === "win32" ? "node-gyp.cmd" : "node-gyp";
const result = spawnSync(command, ["rebuild"], { stdio: "inherit", shell: false });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
