# CoW Worktree

`dev.afaz.cow-worktree` is a Herdr 0.9.1+ plugin that creates a linked Git worktree by reflink-cloning the primary checkout. Unlike a normal Git checkout, ignored files such as `node_modules` and local secrets are included. There is deliberately no ordinary-copy fallback.

Supported platforms:

- macOS (APFS or another filesystem supported by `clonefile(2)`), with a native compiler toolchain
- Linux on a filesystem supporting forced file reflinks

Node.js 20.1+, npm, and Git are required. Linux preserves modes and timestamps, but does not promise ACL or extended-attribute preservation. Symlinks are recreated without following them; sockets, FIFOs, and device files are skipped and reported.

## Local development

```sh
npm ci
npm run build
npm test
herdr plugin link "$PWD"
```

Invoke **Create CoW worktree** from a workspace action menu. The action opens the `creator` popup with an automatically generated branch and destination following Herdr's `<worktrees.directory>/<repo>/<branch>` convention. Press Enter to confirm. You can optionally bind it in `~/.config/herdr/config.toml`:

```toml
[[keys.command]]
key = "prefix+shift+w"
type = "plugin_action"
command = "dev.afaz.cow-worktree.create"
description = "create CoW worktree"
```

The native Herdr worktree creator is unchanged. This plugin adopts its completed checkout with `herdr worktree open`, so adoption emits `worktree.opened` rather than `worktree.created`.

## Safety and failure behavior

The primary checkout must have no tracked changes or non-ignored untracked files. The popup explicitly warns before cloning ignored content. Clone construction occurs under a hidden staging path and becomes visible through an atomic rename. Failures remove plugin-owned worktree metadata, staging paths, and the new branch only while it still points to the captured source HEAD. Submodules initialized in the primary checkout are initialized in the result; their failure rolls back creation.

If Herdr adoption fails after Git creation succeeds, the worktree is intentionally retained and the popup prints the exact recovery command.
