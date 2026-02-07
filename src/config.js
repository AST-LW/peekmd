"use strict";

const fs = require("node:fs");
const path = require("node:path");

const CONFIG_PATH = path.join(require("node:os").homedir(), ".peekmd.json");

function read() {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    } catch {
        return { folders: [] };
    }
}

function write(data) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2) + "\n");
}

function getFolders() {
    return read().folders;
}

function linkFolder(dir) {
    const abs = path.resolve(dir);
    if (!fs.existsSync(abs))
        return { added: false, path: abs, error: "path does not exist" };
    if (!fs.statSync(abs).isDirectory())
        return { added: false, path: abs, error: "not a directory" };

    const data = read();
    if (data.folders.includes(abs)) return { added: false, path: abs };
    data.folders.push(abs);
    write(data);
    return { added: true, path: abs };
}

function unlinkFolder(dir) {
    const abs = path.resolve(dir);
    const data = read();
    const idx = data.folders.indexOf(abs);
    if (idx === -1) return { removed: false, path: abs };
    data.folders.splice(idx, 1);
    write(data);
    return { removed: true, path: abs };
}

function getDisplayNames(folders) {
    const counts = {};
    for (const f of folders) {
        const b = path.basename(f);
        counts[b] = (counts[b] || 0) + 1;
    }
    return folders.map((f) => {
        const b = path.basename(f);
        return counts[b] > 1 ? `${path.basename(path.dirname(f))}/${b}` : b;
    });
}

module.exports = {
    getFolders,
    linkFolder,
    unlinkFolder,
    getDisplayNames,
    CONFIG_PATH,
};
