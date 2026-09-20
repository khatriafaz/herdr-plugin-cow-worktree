type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
}

function stringAt(root: JsonObject | undefined, ...keys: string[]): string | undefined {
  let value: unknown = root;
  for (const key of keys) value = object(value)?.[key];
  return typeof value === "string" && value ? value : undefined;
}

export class HerdrInvocationContext {
  private readonly context: JsonObject | undefined;
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {
    try { this.context = object(JSON.parse(env.HERDR_PLUGIN_CONTEXT_JSON ?? "null")); }
    catch { this.context = undefined; }
  }

  workspaceId(): string | undefined {
    return this.env.HERDR_WORKSPACE_ID ?? stringAt(this.context, "workspace", "workspace_id");
  }

  explicitCwd(): string | undefined {
    return this.env.COW_SOURCE_CWD ?? this.env.HERDR_ACTIVE_PANE_CWD
      ?? stringAt(this.context, "focused_pane", "foreground_cwd")
      ?? stringAt(this.context, "focused_pane", "cwd")
      ?? stringAt(this.context, "worktree", "checkout_path")
      ?? stringAt(this.context, "workspace", "worktree", "checkout_path");
  }

  cwd(): string {
    return this.explicitCwd() ?? process.cwd();
  }
}
