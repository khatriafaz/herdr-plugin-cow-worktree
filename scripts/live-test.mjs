import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";

const exec = promisify(execFile);
const herdr = process.env.HERDR_BIN_PATH ?? "herdr";
const run = async (command, args, options = {}) => {
  const result = await exec(command, args, { encoding: "utf8", ...options });
  return result.stdout;
};
const runJson = async (command, args, options) => JSON.parse(await run(command, args, options));
const socketRequest = (socketPath, request) => new Promise((resolve, reject) => {
  const socket = net.createConnection(socketPath);
  let buffer = "";
  socket.setEncoding("utf8");
  socket.once("error", reject);
  socket.on("data", (chunk) => {
    buffer += chunk;
    const newline = buffer.indexOf("\n");
    if (newline < 0) return;
    socket.end();
    try { resolve(JSON.parse(buffer.slice(0, newline))); } catch (error) { reject(error); }
  });
  socket.once("connect", () => socket.write(`${JSON.stringify(request)}\n`));
});

const root = await mkdtemp(path.join(os.tmpdir(), "cow-worktree-live-"));
const source = path.join(root, "primary");
const configPath = path.join(root, "herdr-config.toml");
let destination;
let parentWorkspace;
let childWorkspace;
let originalWorkspace;

try {
  const snapshot = await runJson(herdr, ["api", "snapshot"]);
  originalWorkspace = snapshot.result?.snapshot?.focused_workspace_id;
  await mkdir(path.join(source, "node_modules", "demo"), { recursive: true });
  await writeFile(path.join(source, ".gitignore"), ".env\nnode_modules/\n");
  await writeFile(path.join(source, "tracked.txt"), "tracked\n");
  await writeFile(path.join(source, ".env"), "LIVE_SECRET=test-only\n", { mode: 0o600 });
  await writeFile(path.join(source, "node_modules", "demo", "index.js"), "export default 1;\n");
  await writeFile(configPath, `[worktrees]\ndirectory = '${path.join(root, "worktrees")}'\n`);
  await run("git", ["init", "-b", "main"], { cwd: source });
  await run("git", ["config", "user.email", "cow-live@example.invalid"], { cwd: source });
  await run("git", ["config", "user.name", "CoW Live Test"], { cwd: source });
  await run("git", ["add", "."], { cwd: source });
  await run("git", ["commit", "-m", "live fixture"], { cwd: source });

  const parent = await runJson(herdr, ["workspace", "create", "--cwd", source, "--label", "CoW live parent", "--focus"]);
  parentWorkspace = parent.result?.workspace?.workspace_id;
  if (!parentWorkspace) throw new Error("Herdr did not return the parent workspace id");

  await runJson(herdr, ["plugin", "action", "invoke", "create", "--plugin", "dev.afaz.cow-worktree"]);
  const status = await run(herdr, ["status", "server"]);
  const socketPath = status.match(/^socket:\s+(.+)$/m)?.[1];
  if (!socketPath) throw new Error("Could not find Herdr's socket for popup verification");
  let popupClosed = false;
  for (let attempt = 0; attempt < 20 && !popupClosed; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const response = await socketRequest(socketPath, { id: `cow-live-${attempt}`, method: "popup.close", params: {} });
    popupClosed = Boolean(response.result);
  }
  if (!popupClosed) throw new Error("The plugin action did not open its creator popup");

  const creator = spawn(process.execPath, [path.resolve("dist/creator.js")], {
    cwd: path.resolve("."),
    env: { ...process.env, HERDR_BIN_PATH: herdr, HERDR_CONFIG_PATH: configPath, COW_SOURCE_CWD: source },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let confirmed = false;
  creator.stdout.on("data", (chunk) => {
    stdout += chunk;
    if (!confirmed && stdout.includes("Create now?")) {
      confirmed = true;
      creator.stdin.end("\n");
    }
  });
  creator.stderr.on("data", (chunk) => { stderr += chunk; });
  const exitCode = await new Promise((resolve, reject) => {
    creator.once("error", reject);
    creator.once("close", resolve);
  });
  if (exitCode !== 0) throw new Error(`Creator exited ${exitCode}: ${stderr || stdout}`);
  destination = stdout.match(/\nCreated \S+ at (.+)\n/)?.[1];
  if (!destination) throw new Error(`Could not read the generated destination from creator output: ${stdout}`);

  const canonicalDestination = await realpath(destination);
  const canonicalSource = await realpath(source);
  let child;
  let workspaces = [];
  for (let attempt = 0; attempt < 20 && !child; attempt += 1) {
    const listed = await runJson(herdr, ["workspace", "list"]);
    workspaces = listed.result?.workspaces ?? [];
    child = workspaces.find((workspace) => path.resolve(workspace.worktree?.checkout_path ?? "") === canonicalDestination);
    if (!child) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!child?.workspace_id) {
    const checkouts = workspaces.map((workspace) => workspace.worktree?.checkout_path).filter(Boolean);
    throw new Error(`Adopted worktree is missing from Herdr's sidebar model. Creator output: ${stdout}. Checkouts: ${JSON.stringify(checkouts)}`);
  }
  if (!child.focused) throw new Error("Adopted worktree did not receive focus");
  if (child.worktree?.repo_root !== canonicalSource || !child.worktree?.is_linked_worktree) {
    throw new Error("Adopted worktree is not grouped beneath the disposable primary checkout");
  }
  childWorkspace = child.workspace_id;
  await run(herdr, ["worktree", "remove", "--workspace", childWorkspace]);
  childWorkspace = undefined;
  process.stdout.write("Live Herdr check passed: creation, grouping, focus, and native removal.\n");
} finally {
  if (childWorkspace) await run(herdr, ["worktree", "remove", "--workspace", childWorkspace, "--force"]).catch(() => undefined);
  if (parentWorkspace) await run(herdr, ["workspace", "close", parentWorkspace, "--group"]).catch(() => undefined);
  if (originalWorkspace) await run(herdr, ["workspace", "focus", originalWorkspace]).catch(() => undefined);
  await rm(root, { recursive: true, force: true });
}
