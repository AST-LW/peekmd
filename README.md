# PeekMD

A CLI tool that renders Markdown files in the browser. Point it at any directory, it starts a local server, opens a two-panel viewer, and live-reloads on every file save.

## Install

```
npm install -g peekmd
```

Requires Node.js 18+.

## Commands

### Server

```bash
peekmd start ./docs        # start server with ./docs
peekmd start               # start server with linked folders
peekmd stop                # stop server
peekmd status              # check server status
PORT=3000 peekmd start     # custom port (default: 4000)
```

Server runs as a daemon. One instance per system. Browser opens automatically on start.

### Folder Management

```bash
peekmd link ./docs         # persist folder to config
peekmd link ./docs ./wiki  # link multiple folders
peekmd unlink ./docs       # remove from config
peekmd list                # show linked folders
peekmd --help              # print help
```

These commands modify `~/.peekmd.json`. Changes take effect on next server start.

## Features

| Feature            | Description                                                     |
| ------------------ | --------------------------------------------------------------- |
| Live Reload        | File changes pushed to browser via WebSocket on every save.     |
| Mermaid Diagrams   | Renders flowcharts, sequence diagrams, and more client-side.    |
| GFM Markdown       | Tables, task lists, code blocks, blockquotes, and more.         |
| File Tree          | Collapsible sidebar with persistent expand/collapse state.      |
| Multi-folder       | Serve multiple directories at once.                             |
| Full-text Search   | Search across file content and filenames.                       |
| Dark / Light Theme | Toggle with browser persistence.                                |
| Daemon Mode        | Runs in background. Start, stop, and check status from the CLI. |
| Browser Launch     | Opens default browser on start.                                 |

## Config

```
~/.peekmd.json
```

Stores absolute folder paths. Created on first `peekmd link`. Human-editable.

## License

MIT
