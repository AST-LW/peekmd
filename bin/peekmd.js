#!/usr/bin/env node

"use strict";

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const config = require("../src/config");
const { createServer } = require("../src/server");

const [cmd, ...rest] = process.argv.slice(2);
const PID_FILE = path.join(os.tmpdir(), "peekmd.pid");

/* ── PID management ────────────────────────────────────────────────── */

const pid = {
    read() {
        try {
            return parseInt(fs.readFileSync(PID_FILE, "utf-8"), 10);
        } catch {
            return null;
        }
    },
    write(id) {
        fs.writeFileSync(PID_FILE, String(id));
    },
    clear() {
        try {
            fs.unlinkSync(PID_FILE);
        } catch {}
    },
    alive(id) {
        try {
            process.kill(id, 0);
            return true;
        } catch {
            return false;
        }
    },
};

/* ── Output ────────────────────────────────────────────────────────── */

const BANNER = `
┌─────────────────────┐
│                     │
│   p e e k  M D     │
│   ─────────────     │
│   │ │ │ │ │ │      │
│                     │
└─────────────────────┘
`;

function printTable(headers, rows) {
    const widths = headers.map(
        (h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)) + 2,
    );
    const line = "  +" + widths.map((w) => "-".repeat(w)).join("+") + "+";

    console.log(line);
    console.log(
        "  |" +
            headers.map((h, i) => (" " + h).padEnd(widths[i])).join("|") +
            "|",
    );
    console.log(line);
    for (const row of rows)
        console.log(
            "  |" +
                row.map((c, i) => (" " + c).padEnd(widths[i])).join("|") +
                "|",
        );
    console.log(line);
}

const HELP = `
  peekmd — Preview Markdown files in the browser

  Server:
    peekmd start                        Start server (daemon)
    peekmd stop                         Stop server
    peekmd status                       Check server status
    peekmd open                         Open browser to server
    PORT=3000 peekmd start              Custom port (default: 4000)

  Folders:
    peekmd link <dir> [dir2] ...        Persist folders to config
    peekmd unlink <dir> [dir2] ...      Remove folders from config
    peekmd list                         Show linked folders

  Ignore:
    peekmd ignore <pattern> ...         Ignore folders/files by glob pattern
    peekmd unignore <pattern> ...       Remove an ignore pattern
    peekmd ignored                      Show all active ignore patterns

  Structured Output:
    peekmd list --json                  Linked folders as JSON
    peekmd ignored --json               Ignore patterns as JSON
    peekmd status --json                Server status as JSON
    peekmd search <query>               Search files and content (JSON)
    peekmd files                        List all markdown files (JSON)

  Other:
    peekmd --help                       Show this help

  Environment:
    PORT=<number>    Server port (default: 4000)

  Config file: ~/.peekmd.json
`;

/* ── Helpers ───────────────────────────────────────────────────────── */

const resolveDirs = (dirs) => dirs.map((d) => path.resolve(d));
const getPort = () => Number(process.env.PORT) || 4000;

function openBrowser(url) {
    const open =
        process.platform === "darwin"
            ? "open"
            : process.platform === "win32"
              ? "start"
              : "xdg-open";
    require("node:child_process").exec(`${open} ${url}`);
}

/* ── Commands ──────────────────────────────────────────────────────── */

switch (cmd) {
    case "--help":
    case "-h":
        console.log(HELP);
        break;

    case "link": {
        if (!rest.length) {
            console.error("  Usage: peekmd link <dir> [dir2] ...");
            process.exit(1);
        }
        for (const dir of rest) {
            const r = config.linkFolder(dir);
            if (r.error) console.error("  ✗ %s — %s", r.path, r.error);
            else if (r.added) console.log("  ✓ Linked    %s", r.path);
            else console.log("  · Already linked    %s", r.path);
        }
        break;
    }

    case "unlink": {
        if (!rest.length) {
            console.error("  Usage: peekmd unlink <dir> [dir2] ...");
            process.exit(1);
        }
        for (const dir of rest) {
            const r = config.unlinkFolder(dir);
            console.log(
                r.removed ? "  ✓ Unlinked    %s" : "  · Not linked    %s",
                r.path,
            );
        }
        break;
    }

    case "list": {
        const folders = config.getFolders();
        if (rest.includes("--json")) {
            const names = config.getDisplayNames(folders);
            console.log(
                JSON.stringify(
                    folders.map((f, i) => ({ name: names[i], path: f })),
                    null,
                    2,
                ),
            );
            break;
        }
        if (!folders.length) {
            console.log("  No folders linked. Run: peekmd link <dir>");
            break;
        }
        const names = config.getDisplayNames(folders);
        console.log("\n  Linked folders:\n");
        printTable(
            ["Name", "Path"],
            folders.map((f, i) => [names[i], f]),
        );
        console.log();
        break;
    }

    case "start": {
        const existing = pid.read();
        if (existing && pid.alive(existing)) {
            console.log("  Server already running (PID: %d)", existing);
            process.exit(0);
        }
        pid.clear();

        const child = require("node:child_process").spawn(
            process.execPath,
            [__filename, "__serve__", ...rest],
            {
                stdio: "ignore",
                detached: true,
                env: { ...process.env, PORT: String(getPort()) },
            },
        );
        child.unref();
        pid.write(child.pid);

        const url = `http://localhost:${getPort()}`;
        console.log(BANNER);
        console.log("  %s\n", url);
        console.log("  To stop: peekmd stop\n");
        openBrowser(url);
        break;
    }

    case "stop": {
        const id = pid.read();
        if (!id || !pid.alive(id)) {
            console.log(
                id
                    ? "  PID %d is not running"
                    : "  No background server running",
                id,
            );
            pid.clear();
            break;
        }
        try {
            process.kill(id, "SIGTERM");
        } catch (e) {
            console.error("  ✗ Failed to stop: %s", e.message);
            break;
        }
        pid.clear();
        console.log("  ✓ Server stopped");
        break;
    }

    case "status": {
        const id = pid.read();
        const running = !!(id && pid.alive(id));
        if (!running && id) pid.clear();
        if (rest.includes("--json")) {
            console.log(
                JSON.stringify({
                    running,
                    pid: running ? id : null,
                    port: Number(process.env.PORT) || 4000,
                }),
            );
            break;
        }
        if (running) {
            console.log(
                "  ✓ Server running (PID: %d, port: %s)",
                id,
                process.env.PORT || 4000,
            );
        } else {
            console.log("  Server not running");
        }
        break;
    }

    case "open": {
        const id = pid.read();
        const running = !!(id && pid.alive(id));
        if (!running && id) pid.clear();
        if (running) {
            const url = `http://localhost:${getPort()}`;
            console.log("  Opening %s", url);
            openBrowser(url);
        } else {
            console.log("  Server not running. Starting...");
            pid.clear();

            const child = require("node:child_process").spawn(
                process.execPath,
                [__filename, "__serve__", ...rest],
                {
                    stdio: "ignore",
                    detached: true,
                    env: { ...process.env, PORT: String(getPort()) },
                },
            );
            child.unref();
            pid.write(child.pid);

            const url = `http://localhost:${getPort()}`;
            console.log("  %s\n", url);
            openBrowser(url);
        }
        break;
    }

    case "ignore": {
        if (!rest.length) {
            console.error("  Usage: peekmd ignore <pattern> [pattern2] ...");
            console.error(
                "  Examples: peekmd ignore '**/node_modules/**' '**/dist/**'",
            );
            console.error("           peekmd ignore '**/*.draft.md'");
            process.exit(1);
        }
        for (const p of rest) {
            const r = config.addIgnorePattern(p);
            console.log(
                r.added
                    ? "  \u2713 Ignoring    %s"
                    : "  \u00b7 Already ignored    %s",
                p,
            );
        }
        break;
    }

    case "unignore": {
        if (!rest.length) {
            console.error("  Usage: peekmd unignore <pattern> [pattern2] ...");
            process.exit(1);
        }
        for (const p of rest) {
            const r = config.removeIgnorePattern(p);
            console.log(
                r.removed
                    ? "  \u2713 Removed    %s"
                    : "  \u00b7 Not in ignore list    %s",
                p,
            );
        }
        break;
    }

    case "ignored": {
        const patterns = config.getIgnorePatterns();
        if (rest.includes("--json")) {
            console.log(
                JSON.stringify(
                    patterns.map((p) => ({ pattern: p })),
                    null,
                    2,
                ),
            );
            break;
        }
        if (!patterns.length) {
            console.log(
                "  No ignore patterns set. Run: peekmd ignore <pattern>",
            );
            break;
        }
        console.log("\n  Ignore patterns (glob):\n");
        for (const p of patterns) {
            console.log("    %s", p);
        }
        console.log();
        break;
    }

    case "search": {
        /* Search across linked folders — outputs JSON for AI agents */
        const query = rest.filter((a) => !a.startsWith("--")).join(" ");
        if (!query) {
            console.error("  Usage: peekmd search <query>");
            process.exit(1);
        }
        const { searchCli } = require("../src/server");
        searchCli(config.getFolders(), query)
            .then((r) => console.log(JSON.stringify(r, null, 2)))
            .catch(() => process.exit(1));
        break;
    }

    case "files": {
        /* List all markdown files across linked folders — JSON output */
        const { listFilesCli } = require("../src/server");
        listFilesCli(config.getFolders())
            .then((r) => console.log(JSON.stringify(r, null, 2)))
            .catch(() => process.exit(1));
        break;
    }

    case "__serve__": {
        /* Internal: spawned by 'start' as a detached daemon */
        const extra = rest.length ? resolveDirs(rest) : [];
        const port = getPort();

        createServer({ port, extraDirs: extra }).catch(() => process.exit(1));
        break;
    }

    default: {
        console.log(HELP);
        break;
    }
}
