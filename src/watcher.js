"use strict";

const path = require("node:path");
const chokidar = require("chokidar");

const EVENTS = ["change", "add", "unlink"];

function createWatcher(dir, broadcast) {
    const watcher = chokidar.watch("**/*.md", {
        cwd: dir,
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 200 },
    });

    for (const event of EVENTS) {
        watcher.on(event, (filePath) => {
            broadcast({
                type: event,
                folder: dir,
                path: filePath.split(path.sep).join("/"),
            });
        });
    }

    return watcher;
}

module.exports = { createWatcher };
