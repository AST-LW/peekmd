"use strict";

const path = require("node:path");
const chokidar = require("chokidar");
const config = require("./config");

const EVENTS = ["change", "add", "unlink"];

/**
 * Create a file watcher for a directory.
 * @param {string} dir - Directory to watch
 * @param {function} broadcast - Callback to broadcast changes
 * @param {function} [log] - Optional logger for debug output
 * @returns {chokidar.FSWatcher}
 */
function createWatcher(dir, broadcast, log = () => {}) {
    const ignored = [
        (filePath) => {
            const rel = path.relative(dir, filePath).split(path.sep).join("/");
            if (!rel || rel === ".") return false;
            return config.isIgnored(rel);
        },
    ];

    const watcher = chokidar.watch(dir, {
        ignoreInitial: true,
        ignored,
        usePolling: false,
        atomic: true,
        awaitWriteFinish: {
            stabilityThreshold: 100,
            pollInterval: 50,
        },
    });

    watcher.on("ready", () => {});
    watcher.on("error", () => {});

    for (const event of EVENTS) {
        watcher.on(event, (absPath) => {
            if (!absPath.toLowerCase().endsWith(".md")) return;
            const rel = path.relative(dir, absPath).split(path.sep).join("/");
            if (config.isIgnored(rel)) return;
            broadcast({ type: event, folder: dir, path: rel });
        });
    }

    return watcher;
}

/**
 * Create a watcher for the config file to detect external changes.
 * @param {function} onChange - Callback when config file changes
 * @param {function} [log] - Optional logger
 * @returns {chokidar.FSWatcher}
 */
function createConfigWatcher(onChange, log = () => {}) {
    const configPath = config.CONFIG_PATH;

    const watcher = chokidar.watch(configPath, {
        ignoreInitial: true,
        usePolling: false,
        atomic: true,
        awaitWriteFinish: {
            stabilityThreshold: 100,
            pollInterval: 50,
        },
    });

    watcher.on("change", onChange);
    watcher.on("ready", () => {});

    return watcher;
}

module.exports = { createWatcher, createConfigWatcher };
