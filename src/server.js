"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const http = require("node:http");
const express = require("express");
const { WebSocketServer } = require("ws");
const { createWatcher } = require("./watcher");
const config = require("./config");

const watchers = new Map();

/* ── Utilities ─────────────────────────────────────────────────────── */

async function scanMarkdown(dir, root = dir) {
    const results = [];
    try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory())
                results.push(...(await scanMarkdown(full, root)));
            else if (e.name.endsWith(".md"))
                results.push(path.relative(root, full));
        }
    } catch {}
    return results.sort();
}

function broadcast(wss, data) {
    const msg = JSON.stringify(data);
    for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
}

function startWatcher(folder, wss) {
    if (!watchers.has(folder))
        watchers.set(
            folder,
            createWatcher(folder, (d) => broadcast(wss, d)),
        );
}

function stopWatcher(folder) {
    const w = watchers.get(folder);
    if (w) {
        w.close();
        watchers.delete(folder);
    }
}

async function searchFiles(folders, query) {
    const results = [];
    const q = query.toLowerCase();

    for (const folder of folders) {
        for (const file of await scanMarkdown(folder)) {
            try {
                const lines = (
                    await fs.readFile(path.join(folder, file), "utf-8")
                ).split("\n");
                const matches = lines
                    .map((text, i) => ({ line: i + 1, text: text.trim() }))
                    .filter((m) => m.text.toLowerCase().includes(q));

                if (matches.length || file.toLowerCase().includes(q))
                    results.push({ folder, file, matches });
            } catch {}
        }
    }
    return results;
}

/* ── Server ────────────────────────────────────────────────────────── */

async function createServer({ port, extraDirs = [] }) {
    const app = express();
    const server = http.createServer(app);
    const wss = new WebSocketServer({ server });

    app.use(express.static(path.join(__dirname, "public")));
    app.use(express.json());

    const getAllFolders = () => {
        const linked = config.getFolders();
        for (const d of extraDirs) if (!linked.includes(d)) linked.push(d);
        return linked;
    };

    const isWithin = (parent, child) => {
        const rel = path.relative(parent, child);
        return !rel.startsWith("..") && !path.isAbsolute(rel);
    };

    /* ── Routes ────────────────────────────────────────────────────── */

    app.get("/api/folders", async (_req, res) => {
        const folders = getAllFolders();
        const names = config.getDisplayNames(folders);
        const result = await Promise.all(
            folders.map(async (folder, i) => ({
                folder,
                name: names[i],
                files: await scanMarkdown(folder),
            })),
        );
        res.json(result);
    });

    app.get("/api/file", async (req, res) => {
        const { folder, path: rel } = req.query;
        if (!folder || !rel)
            return res.status(400).json({ error: "folder and path required" });
        if (!getAllFolders().includes(folder))
            return res.status(403).json({ error: "folder not linked" });

        const abs = path.resolve(folder, rel);
        if (!isWithin(folder, abs))
            return res.status(403).json({ error: "forbidden" });

        try {
            res.json({ content: await fs.readFile(abs, "utf-8") });
        } catch {
            res.status(404).json({ error: "not found" });
        }
    });

    app.post("/api/link", (req, res) => {
        const { folder } = req.body;
        if (!folder) return res.status(400).json({ error: "folder required" });

        const result = config.linkFolder(folder);
        if (result.error) return res.status(400).json(result);
        if (result.added) startWatcher(result.path, wss);
        broadcast(wss, { type: "folders-changed" });
        res.json(result);
    });

    app.post("/api/unlink", (req, res) => {
        const { folder } = req.body;
        if (!folder) return res.status(400).json({ error: "folder required" });

        const result = config.unlinkFolder(folder);
        if (result.removed) stopWatcher(result.path);
        broadcast(wss, { type: "folders-changed" });
        res.json(result);
    });

    app.get("/api/browse", async (req, res) => {
        const resolved = path.resolve(
            req.query.path || require("node:os").homedir(),
        );
        try {
            const entries = await fs.readdir(resolved, { withFileTypes: true });
            res.json({
                current: resolved,
                parent: path.dirname(resolved),
                dirs: entries
                    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
                    .map((e) => ({
                        name: e.name,
                        path: path.join(resolved, e.name),
                    }))
                    .sort((a, b) => a.name.localeCompare(b.name)),
            });
        } catch {
            res.status(400).json({ error: "cannot read directory" });
        }
    });

    app.get("/api/search", async (req, res) => {
        const { q } = req.query;
        if (!q || q.length < 2)
            return res.status(400).json({ error: "query too short" });
        res.json(await searchFiles(getAllFolders(), q));
    });

    for (const folder of getAllFolders()) startWatcher(folder, wss);
    return new Promise((resolve) => server.listen(port, resolve));
}

module.exports = { createServer };
