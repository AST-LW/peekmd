# peek MD

A CLI tool that renders Markdown files in the browser and live-reloads on every file save.

## Install

```bash
npm i -g @astlw/peekmd
```

Requires Node.js 18+.

## Features

| Feature                      | Summary                                                                                                                      | Why it matters                                                      |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Live reload                  | Real-time file events over WebSocket; open file preview refreshes on `add`/`change`/`unlink`.                                | Instant feedback while editing files.                               |
| Folder groups (multi-folder) | Sidebar shows each linked folder as a separate group; when folder basenames collide a compact path is shown to disambiguate. | Keep multiple projects side-by-side without confusion.              |
| File tree                    | Per-folder collapsible file tree with relative paths; click a file to render Markdown in the preview.                        | Fast navigation and focused previews.                               |
| Ignore patterns (glob)       | Glob-only patterns (picomatch) applied to watcher, search, and tree.                                                         | Simple, consistent filtering across the app. Quote globs in shells. |
| Search                       | Lightweight full-text substring search across filenames and file contents.                                                   | Fast, low-overhead lookup for most small/medium projects.           |
| Markdown + Mermaid           | Renders GFM and client-side Mermaid diagrams inside `mermaid` fences.                                                        | Rich previews without server-side rendering.                        |
| Daemon & CLI                 | Start/stop/status plus `--json` machine-readable output for scripts and agents.                                              | Integrates with workflows and automation.                           |

## Config

Linked folders and ignore patterns are stored in:

```
~/.peekmd.json
```

```json
{
    "folders": ["/Users/you/docs", "/Users/you/notes"],
    "ignore": ["**/node_modules/**", "**/dist/**", "**/*.draft.md"]
}
```

Created automatically on first use. Can be edited manually.

## CLI Commands

```bash
# Server
peekmd start                        # start server (daemon)
peekmd stop                         # stop server
peekmd status                       # check server status
peekmd open                         # open browser (starts server if not running)
PORT=3000 peekmd start              # custom port (default: 4000)

# Folder management
peekmd link <dir> [dir2] ...        # persist folders to config
peekmd unlink <dir> [dir2] ...      # remove folders from config
peekmd list                         # show linked folders

# Ignore patterns (glob syntax)
peekmd ignore <pattern> ...         # ignore folders/files by glob pattern
peekmd unignore <pattern> ...       # remove an ignore pattern
peekmd ignored                      # show all active ignore patterns

# Structured Output (Useful for integrating with scripts or other tools)
peekmd list --json                  # linked folders as JSON
peekmd ignored --json               # ignore patterns as JSON
peekmd status --json                # server status as JSON
peekmd search <query>               # search files and content (JSON)
peekmd files                        # list all markdown files (JSON)

peekmd --help                       # print help
```

### Ignore Patterns

Ignore patterns let you exclude folders or files from the file tree, search, and live-reload.
Patterns are stored in `~/.peekmd.json` and apply globally.
All patterns use glob syntax (picomatch).

Examples:

```bash
peekmd ignore "**/node_modules/**"         # ignores all node_modules folders
peekmd ignore "**/dist/**" "**/build/**"   # ignore multiple patterns
peekmd ignore "**/*.draft.md"              # ignores all .draft.md files
peekmd ignore "docs/private/**"            # ignores everything under docs/private
peekmd ignore "*.tmp"                      # ignores .tmp files at any depth
```

#### How they work:

Ignore patterns are global and applied to every linked folder. Each pattern is tested against the file path **relative to that folder’s root**.

| Linked Folder        | File Path                              | Relative Path               | Pattern              | Matches |
| -------------------- | -------------------------------------- | --------------------------- | -------------------- | ------- |
| `/Users/you/project` | `/Users/you/project/docs/private/a.md` | `docs/private/a.md`         | `docs/private/**`    | ✅ Yes  |
| `/Users/you/project` | `/Users/you/project/README.md`         | `README.md`                 | `docs/private/**`    | ❌ No   |
| `/Users/you`         | `/Users/you/project/docs/private/a.md` | `project/docs/private/a.md` | `docs/private/**`    | ❌ No   |
| `/Users/you`         | `/Users/you/project/docs/private/a.md` | `project/docs/private/a.md` | `**/docs/private/**` | ✅ Yes  |
| `/Users/you/project` | `/Users/you/project/build/tmp.log`     | `build/tmp.log`             | `**/build/**`        | ✅ Yes  |
| `/Users/you/project` | `/Users/you/project/src/file.draft.md` | `src/file.draft.md`         | `**/*.draft.md`      | ✅ Yes  |
| `/Users/you/project` | `/Users/you/project/foo.tmp`           | `foo.tmp`                   | `**/*.tmp`           | ✅ Yes  |

#### Default patterns (applied automatically on first use):

```
**/node_modules/**
**/.git/**
**/dist/**
**/build/**
**/.next/**
**/__pycache__/**
```

### NOTE

- Ignore patterns are glob-only (picomatch). Regex/exact-name modes are not supported.
- Search is intentionally simple (substring per-line) for clarity and low resource usage.
