"use strict";

const fs = require("node:fs");
const path = require("node:path");
const picomatch = require("picomatch");

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
    clearGlobCache();
    return { added: true, path: abs };
}

function unlinkFolder(dir) {
    const abs = path.resolve(dir);
    const data = read();
    const idx = data.folders.indexOf(abs);
    if (idx === -1) return { removed: false, path: abs };
    data.folders.splice(idx, 1);
    write(data);
    clearGlobCache();
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

/* ── Ignore patterns ───────────────────────────────────────────────── */

const DEFAULT_IGNORE = [
    // Node / JS
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/.next/**",

    // Git
    "**/.git/**",

    // Python
    "**/__pycache__/**",
    "**/*.pyc",
    "**/.venv/**",
    "**/venv/**",
    "**/env/**",
    "**/.pytest_cache/**",
    "**/.mypy_cache/**",

    // Java / JVM
    "**/target/**",
    "**/*.class",
    "**/*.jar",

    // Rust / Cargo
    "**/target/**",

    // Go
    "**/vendor/**",
    "**/pkg/**",

    // C / C++ / native artifacts
    "**/*.o",
    "**/*.so",
    "**/*.dll",
    "**/*.exe",

    // IDE / editor caches
    "**/.idea/**",
    "**/.vscode/**",
    "**/.cache/**",

    // Misc / build systems
    "**/.gradle/**",
    "**/__pycache__/**",
    "**/.tox/**",
];

function ensureDefaults() {
    const data = read();
    if (!data.ignore) {
        data.ignore = [...DEFAULT_IGNORE];
        write(data);
    }
}

function getIgnorePatterns() {
    const data = read();
    const user = data.ignore || [];
    return [...DEFAULT_IGNORE, ...user];
}

function addIgnorePattern(pattern) {
    const data = read();
    if (!data.ignore) data.ignore = [];
    if (data.ignore.includes(pattern)) return { added: false, pattern };
    data.ignore.push(pattern);
    write(data);
    clearGlobCache();
    return { added: true, pattern };
}

function removeIgnorePattern(pattern) {
    const data = read();
    if (!data.ignore) return { removed: false, pattern };
    const idx = data.ignore.indexOf(pattern);
    if (idx === -1) return { removed: false, pattern };
    data.ignore.splice(idx, 1);
    write(data);
    clearGlobCache();
    return { removed: true, pattern };
}

/* pre-compiled glob cache so we don't re-parse every call */
const _globCache = new Map();

function clearGlobCache() {
    _globCache.clear();
}

function getGlobMatcher(pattern) {
    if (!_globCache.has(pattern)) {
        _globCache.set(pattern, picomatch(pattern, { dot: true }));
    }
    return _globCache.get(pattern);
}

/**
 * Test whether a relative path should be ignored.
 * All patterns are treated as glob patterns (picomatch syntax).
 */
function isIgnored(relPath) {
    const patterns = getIgnorePatterns();
    for (const p of patterns) {
        if (getGlobMatcher(p)(relPath)) return true;
    }
    return false;
}

module.exports = {
    getFolders,
    linkFolder,
    unlinkFolder,
    getDisplayNames,
    ensureDefaults,
    getIgnorePatterns,
    addIgnorePattern,
    removeIgnorePattern,
    isIgnored,
    clearGlobCache,
    CONFIG_PATH,
};
