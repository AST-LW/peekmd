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
    peekmd start [dir] [dir2] ...   Start server (daemon)
    peekmd stop                     Stop server
    peekmd status                   Check if server is running

  Folders:
    peekmd link <dir> [dir2] ...    Link folders for persistent tracking
    peekmd unlink <dir> [dir2] ...  Remove folders from tracking
    peekmd list                     Show all linked folders
    peekmd --help                   Show this help

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
        if (id && pid.alive(id)) {
            console.log(
                "  ✓ Server running (PID: %d, port: %s)",
                id,
                process.env.PORT || 4000,
            );
        } else {
            if (id) pid.clear();
            console.log("  Server not running");
        }
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
