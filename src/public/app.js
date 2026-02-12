"use strict";

/* ── State ─────────────────────────────────────────────────────────── */

let activeFolderPath = null;
let activeFilePath = null;
const collapsedNodes = new Set();
// map folder path -> compact display (used when basenames collide)
let folderDisplayMap = {};

/* ── Icons ─────────────────────────────────────────────────────────── */

const svg = (cls, w, paths) =>
    `<svg class="${cls}" viewBox="0 0 24 24" width="${w}" height="${w}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

const ICONS = {
    file: svg(
        "file-icon",
        14,
        '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
    ),
    folder: svg(
        "folder-icon",
        14,
        '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    ),
    chevron: svg("folder-chevron", 14, '<polyline points="6 9 12 15 18 9"/>'),
    unlink: svg(
        "",
        12,
        '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    ),
    treeChevron: svg("tree-chevron", 12, '<polyline points="9 6 15 12 9 18"/>'),
    treeFolder: svg(
        "tree-folder-icon",
        14,
        '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    ),
};

/* ── Theme ─────────────────────────────────────────────────────────── */

function initTheme() {
    const saved = localStorage.getItem("peekmd-theme") || "dark";
    document.documentElement.setAttribute("data-theme", saved);

    document.getElementById("themeToggle").addEventListener("click", () => {
        const next =
            document.documentElement.getAttribute("data-theme") === "dark"
                ? "light"
                : "dark";
        document.documentElement.setAttribute("data-theme", next);
        localStorage.setItem("peekmd-theme", next);
    });
}

/* ── Markdown ──────────────────────────────────────────────────────── */

const escapeHtml = (s) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function resolveLink(href) {
    if (!activeFolderPath || !activeFilePath) return null;
    let base = activeFolderPath;
    if (activeFilePath.includes("/")) {
        const dir = activeFilePath.substring(
            0,
            activeFilePath.lastIndexOf("/"),
        );
        base += "/" + dir;
    }
    try {
        const resolved = new URL(href, "file://" + base + "/").pathname;
        return resolved;
    } catch {
        return null;
    }
}

async function renderMarkdown(raw) {
    const body = document.getElementById("markdownBody");
    const re = /^[ \t]*```mermaid[ \t]*\n([\s\S]*?)^[ \t]*```[ \t]*$/gm;
    const segments = [];
    let cursor = 0,
        match;

    while ((match = re.exec(raw)) !== null) {
        if (match.index > cursor)
            segments.push({ type: "md", text: raw.slice(cursor, match.index) });
        segments.push({ type: "mermaid", text: match[1].trim() });
        cursor = match.index + match[0].length;
    }
    if (cursor < raw.length)
        segments.push({ type: "md", text: raw.slice(cursor) });

    let html = "",
        mid = 0;
    for (const s of segments) {
        html +=
            s.type === "md"
                ? marked.parse(s.text)
                : `<div class="mermaid-container"><pre class="mermaid" id="m${++mid}">${escapeHtml(s.text)}</pre></div>`;
    }
    body.innerHTML = html;

    /* render mermaid */
    const theme = document.documentElement.getAttribute("data-theme");
    mermaid.initialize({
        startOnLoad: false,
        theme: theme === "dark" ? "dark" : "default",
        securityLevel: "loose",
    });

    for (const el of body.querySelectorAll("pre.mermaid")) {
        try {
            const { svg } = await mermaid.render(
                el.id + "_svg",
                el.textContent,
            );
            el.parentElement.innerHTML = svg;
        } catch {
            el.classList.add("mermaid-error");
        }
    }

    // Handle internal links
    body.querySelectorAll("a").forEach((a) => {
        a.addEventListener("click", async (e) => {
            const href = a.getAttribute("href");
            if (
                href &&
                !href.startsWith("http") &&
                !href.startsWith("//") &&
                !href.startsWith("mailto:") &&
                !href.startsWith("#")
            ) {
                e.preventDefault();
                const resolved = resolveLink(href);
                if (resolved) {
                    for (const g of window.groups || []) {
                        if (resolved.startsWith(g.folder + "/")) {
                            const relPath = resolved.slice(g.folder.length + 1);
                            await selectFile(g.folder, relPath);
                            return;
                        }
                    }
                }
            }
        });
    });

    // Handle images - resolve relative image paths to proper URLs
    body.querySelectorAll("img").forEach((img) => {
        const src = img.getAttribute("src");
        if (
            src &&
            !src.startsWith("http") &&
            !src.startsWith("https") &&
            !src.startsWith("//") &&
            !src.startsWith("data:")
        ) {
            const resolved = resolveLink(src);
            if (!resolved) return;

            const candidates = [];

            // Try to match any linked folder in the resolved path
            for (const g of window.groups || []) {
                // If the resolved path starts with the folder, strip the folder prefix
                if (resolved.startsWith(g.folder + "/")) {
                    const relPath = resolved.slice(g.folder.length + 1);
                    candidates.push(
                        `/files/${encodeURIComponent(g.folder)}/${relPath}`,
                    );
                    break;
                }

                // If the folder appears anywhere in the resolved path, use it
                const idx = resolved.indexOf(g.folder + "/");
                if (idx !== -1) {
                    const relPath = resolved.slice(idx + g.folder.length + 1);
                    candidates.push(
                        `/files/${encodeURIComponent(g.folder)}/${relPath}`,
                    );
                    break;
                }
            }

            // If path contains src/public, serve from static root
            if (resolved.includes("/src/public/")) {
                const parts = resolved.split("/src/public/");
                if (parts[1]) candidates.push("/" + parts[1]);
            }

            // Try the original src as relative to current folder
            if (window.groups && window.groups[0] && src.startsWith("./")) {
                const relPath = src.slice(2); // Remove "./"
                candidates.push(
                    `/files/${encodeURIComponent(window.groups[0].folder)}/${relPath}`,
                );
            }

            if (candidates.length === 0) return;

            let idx = 0;
            const tryNext = () => {
                if (idx >= candidates.length) return;
                img.src = candidates[idx++];
            };

            img.addEventListener("error", tryNext);
            tryNext();
        }
    });
}

/* ── API ───────────────────────────────────────────────────────────── */

const api = {
    async folders() {
        return (await fetch("/api/folders")).json();
    },
    async file(folder, path) {
        const res = await fetch(
            "/api/file?" + new URLSearchParams({ folder, path }),
        );
        return res.ok ? (await res.json()).content : null;
    },
    async link(folder) {
        return (
            await fetch("/api/link", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ folder }),
            })
        ).json();
    },
    async unlink(folder) {
        return (
            await fetch("/api/unlink", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ folder }),
            })
        ).json();
    },
    async browse(dir) {
        return (
            await fetch(
                "/api/browse?" +
                    (dir ? new URLSearchParams({ path: dir }) : ""),
            )
        ).json();
    },
    async search(q) {
        const r = await fetch("/api/search?" + new URLSearchParams({ q }));
        return r.ok ? r.json() : [];
    },
    async getIgnorePatterns() {
        return (await fetch("/api/ignore")).json();
    },
    async addIgnore(pattern) {
        return (
            await fetch("/api/ignore", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ pattern }),
            })
        ).json();
    },
    async removeIgnore(pattern) {
        return (
            await fetch("/api/unignore", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ pattern }),
            })
        ).json();
    },
};

/* ── Search ────────────────────────────────────────────────────────── */

function initSearch() {
    const input = document.getElementById("searchInput");
    const clearBtn = document.getElementById("searchClear");
    const resultsEl = document.getElementById("searchResults");
    const folderList = document.getElementById("folderList");
    let timer = null;

    function clear() {
        input.value = "";
        clearBtn.style.display = "none";
        resultsEl.style.display = "none";
        folderList.style.display = "";
    }

    input.addEventListener("input", () => {
        clearTimeout(timer);
        const q = input.value.trim();
        clearBtn.style.display = q.length ? "" : "none";
        if (q.length < 2) {
            resultsEl.style.display = "none";
            folderList.style.display = "";
            return;
        }
        timer = setTimeout(() => runSearch(q), 250);
    });
    input.addEventListener("keydown", (e) => {
        if (e.key === "Escape") clear();
    });
    clearBtn.addEventListener("click", clear);

    async function runSearch(query) {
        const results = await api.search(query);
        folderList.style.display = "none";
        resultsEl.style.display = "";

        if (!results.length) {
            resultsEl.innerHTML =
                '<div class="search-no-results">No results found</div>';
            return;
        }

        const highlight = (text, q) => {
            const re = new RegExp(
                "(" + q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")",
                "gi",
            );
            return escapeHtml(text).replace(re, "<mark>$1</mark>");
        };

        resultsEl.innerHTML = results
            .map(
                (r) =>
                    `<div class="search-result-file" data-folder="${r.folder}" data-path="${r.file}">${ICONS.file} ${escapeHtml(r.file)}</div>` +
                    r.matches
                        .slice(0, 5)
                        .map(
                            (m) =>
                                `<div class="search-match" data-folder="${r.folder}" data-path="${r.file}"><span class="line-num">${m.line}</span>${highlight(m.text, query)}</div>`,
                        )
                        .join(""),
            )
            .join("");

        resultsEl.querySelectorAll("[data-path]").forEach((el) =>
            el.addEventListener("click", () => {
                selectFile(el.dataset.folder, el.dataset.path);
                clear();
            }),
        );
    }
}

/* ── Sidebar ───────────────────────────────────────────────────────── */

const EMPTY_STATE = `<div class="empty-folders">
  ${svg("", 40, '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>')}
  <div>No folders linked.</div>
</div>`;

const HOME_HTML = `
<div class="home">
    <div class="home-logo">
        <div class="logo-box">
            <div class="logo-text">peek MD</div>
            <div class="logo-lines">
                <span></span><span></span><span></span><span></span><span></span>
            </div>
        </div>
    </div>
    <div class="home-desc">Preview markdown files in browser.</div>
    <div class="home-cta">Get started: <code>peekmd link &lt;folder_path&gt;</code> or click the <strong>folder icon</strong></div>
</div>`;

function buildTree(files) {
    const root = {};
    for (const f of files) {
        const parts = f.split("/");
        let node = root;
        for (let i = 0; i < parts.length - 1; i++) node = node[parts[i]] ??= {};
        node[parts.at(-1)] = null;
    }
    return root;
}

function renderTree(tree, folder, prefix, depth) {
    const entries = Object.keys(tree).sort((a, b) => {
        const ad = tree[a] !== null,
            bd = tree[b] !== null;
        return ad !== bd ? (ad ? -1 : 1) : a.localeCompare(b);
    });

    return entries
        .map((name) => {
            const fullPath = prefix ? prefix + "/" + name : name;

            if (tree[name] === null) {
                const active =
                    activeFolderPath === folder && activeFilePath === fullPath
                        ? " active"
                        : "";
                const badge = folderDisplayMap[folder]
                    ? `<span class="file-badge">${escapeHtml(folderDisplayMap[folder])}</span>`
                    : "";
                return `<div class="file-item${active}" data-folder="${escapeHtml(folder)}" data-path="${escapeHtml(fullPath)}" style="padding-left:${14 + depth * 16}px" data-tip="${escapeHtml(fullPath)}">${ICONS.file} ${badge} ${escapeHtml(name)}</div>`;
            }

            const key = folder + ":" + fullPath;
            const collapsed = collapsedNodes.has(key) ? " collapsed" : "";
            return `<div class="tree-dir${collapsed}" data-node-key="${escapeHtml(key)}">
            <div class="tree-dir-header" style="padding-left:${10 + depth * 16}px" data-tip="${escapeHtml(fullPath)}">${ICONS.treeChevron} ${ICONS.treeFolder} <span>${escapeHtml(name)}</span></div>
            <div class="tree-dir-children">${renderTree(tree[name], folder, fullPath, depth + 1)}</div>
        </div>`;
        })
        .join("");
}

async function refreshSidebar() {
    const list = document.getElementById("folderList");
    const groups = await api.folders();
    window.groups = groups;

    if (!groups.length) {
        list.innerHTML = EMPTY_STATE;
        document.getElementById("markdownBody").innerHTML = HOME_HTML;
        return;
    }

    // compute display map for folders with colliding basenames
    const nameCounts = {};
    for (const g of groups) nameCounts[g.name] = (nameCounts[g.name] || 0) + 1;
    folderDisplayMap = {};
    const shortPath = (p) => {
        if (!p) return "";
        const parts = p.split(/[\\/]+/).filter(Boolean);
        if (parts.length <= 2) return parts.join("/");
        return "…/" + parts.slice(-2).join("/");
    };

    for (const g of groups) {
        folderDisplayMap[g.folder] =
            nameCounts[g.name] > 1 ? shortPath(g.folder) : "";
    }

    list.innerHTML = groups
        .map((g) => {
            const collapsed = collapsedNodes.has("root:" + g.folder)
                ? " collapsed"
                : "";
            const files = g.files.length
                ? renderTree(buildTree(g.files), g.folder, "", 0)
                : '<div class="file-item" style="opacity:.4;cursor:default;">No .md files</div>';

            const compact = folderDisplayMap[g.folder]
                ? `<span class="folder-path-compact">${escapeHtml(folderDisplayMap[g.folder])}</span>`
                : "";

            return `<div class="folder-group${collapsed}" data-folder="${escapeHtml(g.folder)}">
            <div class="folder-header">
                <div class="folder-label">${ICONS.folder} <div class="folder-label-text"><span class="folder-name" title="${escapeHtml(g.folder)}">${escapeHtml(g.name)}</span>${compact}</div></div>
                <button class="folder-unlink" data-unlink="${escapeHtml(g.folder)}" data-tip="Unlink folder">${ICONS.unlink}</button>
                ${ICONS.chevron}
            </div>
            <div class="folder-files">${files}</div>
        </div>`;
        })
        .join("");

    /* event delegation */
    list.querySelectorAll(".file-item[data-path]").forEach((el) =>
        el.addEventListener("click", () =>
            selectFile(el.dataset.folder, el.dataset.path),
        ),
    );

    list.querySelectorAll(".folder-header").forEach((el) =>
        el.addEventListener("click", (e) => {
            if (e.target.closest(".folder-unlink")) return;
            const group = el.closest(".folder-group");
            const key = "root:" + group.dataset.folder;
            group.classList.toggle("collapsed");
            collapsedNodes[
                group.classList.contains("collapsed") ? "add" : "delete"
            ](key);
        }),
    );

    list.querySelectorAll(".tree-dir-header").forEach((el) =>
        el.addEventListener("click", () => {
            const dir = el.closest(".tree-dir");
            const key = dir.dataset.nodeKey;
            dir.classList.toggle("collapsed");
            collapsedNodes[
                dir.classList.contains("collapsed") ? "add" : "delete"
            ](key);
        }),
    );

    list.querySelectorAll(".folder-unlink").forEach((el) =>
        el.addEventListener("click", async () => {
            await api.unlink(el.dataset.unlink);
            if (activeFolderPath === el.dataset.unlink) {
                activeFolderPath = activeFilePath = null;
                document.getElementById("markdownBody").innerHTML = HOME_HTML;
            }
            refreshSidebar();
        }),
    );
}

async function selectFile(folder, filePath) {
    activeFolderPath = folder;
    activeFilePath = filePath;
    const content = await api.file(folder, filePath);
    if (content !== null) await renderMarkdown(content);
    refreshSidebar();
}

/* ── Modal ─────────────────────────────────────────────────────────── */

function initModal() {
    const overlay = document.getElementById("modalOverlay");
    const input = document.getElementById("folderInput");
    const browserList = document.getElementById("browserList");
    const browserPath = document.getElementById("browserPath");

    const open = () => {
        overlay.classList.add("open");
        input.value = "";
        input.focus();
        loadBrowser();
    };
    const close = () => overlay.classList.remove("open");

    document.getElementById("addFolderBtn").addEventListener("click", open);
    document.getElementById("modalClose").addEventListener("click", close);
    document.getElementById("modalCancel").addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) close();
    });

    document
        .getElementById("modalConfirm")
        .addEventListener("click", async () => {
            const val = input.value.trim();
            if (!val) return;
            const r = await api.link(val);
            if (r.error) {
                input.style.borderColor = "var(--danger)";
                setTimeout(() => (input.style.borderColor = ""), 1200);
                return;
            }
            close();
            refreshSidebar();
        });

    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") document.getElementById("modalConfirm").click();
        if (e.key === "Escape") close();
    });

    async function loadBrowser(dirPath) {
        try {
            const data = await api.browse(dirPath);
            browserPath.textContent = data.current;
            input.value = data.current;

            let html = "";
            if (data.parent && data.parent !== data.current)
                html += `<div class="browser-item parent-dir" data-path="${data.parent}">${svg("", 16, '<polyline points="15 18 9 12 15 6"/>')} ..</div>`;

            for (const d of data.dirs)
                html += `<div class="browser-item" data-path="${d.path}">${svg("", 16, '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>')} ${d.name}</div>`;

            if (
                !data.dirs.length &&
                !(data.parent && data.parent !== data.current)
            )
                html +=
                    '<div class="browser-item" style="opacity:.4;cursor:default;">Empty directory</div>';

            browserList.innerHTML = html;
            browserList
                .querySelectorAll(".browser-item[data-path]")
                .forEach((el) =>
                    el.addEventListener("click", () =>
                        loadBrowser(el.dataset.path),
                    ),
                );
        } catch {
            browserPath.textContent = "Error loading directory";
        }
    }
}

/* ── Config Panel ──────────────────────────────────────────────────── */

function initConfigPanel() {
    const overlay = document.getElementById("configOverlay");
    const tabs = overlay.querySelectorAll(".config-tab");
    const foldersPanel = document.getElementById("configFolders");
    const ignorePanel = document.getElementById("configIgnore");

    const open = () => {
        overlay.classList.add("open");
        loadFolders();
        loadIgnore();
    };
    const close = () => overlay.classList.remove("open");

    document.getElementById("configBtn").addEventListener("click", open);
    document.getElementById("configClose").addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) close();
    });

    /* tabs */
    tabs.forEach((tab) =>
        tab.addEventListener("click", () => {
            tabs.forEach((t) => t.classList.remove("active"));
            tab.classList.add("active");
            foldersPanel.style.display =
                tab.dataset.tab === "folders" ? "" : "none";
            ignorePanel.style.display =
                tab.dataset.tab === "ignore" ? "" : "none";
        }),
    );

    /* ── Folders ── */

    async function loadFolders() {
        const groups = await api.folders();
        const list = document.getElementById("configFolderList");
        if (!groups.length) {
            list.innerHTML =
                '<div class="config-empty">No folders linked</div>';
            return;
        }
        list.innerHTML = groups
            .map(
                (g) =>
                    `<div class="config-item">
                        <div class="config-item-info">
                            <div class="config-item-meta" title="${escapeHtml(g.folder)}">
                                <span class="config-item-name">${escapeHtml(g.name)}</span>
                                <span class="config-item-detail">${escapeHtml(g.folder)}</span>
                            </div>
                        </div>
                        <button class="config-remove" data-folder="${escapeHtml(g.folder)}" data-tip="Unlink">${ICONS.unlink}</button>
                    </div>`,
            )
            .join("");

        list.querySelectorAll(".config-remove[data-folder]").forEach((btn) =>
            btn.addEventListener("click", async () => {
                await api.unlink(btn.dataset.folder);
                if (activeFolderPath === btn.dataset.folder) {
                    activeFolderPath = activeFilePath = null;
                    document.getElementById("markdownBody").innerHTML =
                        '<div class="empty-state">Select a file to preview</div>';
                }
                loadFolders();
                refreshSidebar();
            }),
        );
    }

    const folderInput = document.getElementById("configFolderInput");
    document
        .getElementById("configFolderAdd")
        .addEventListener("click", async () => {
            const val = folderInput.value.trim();
            if (!val) return;
            const r = await api.link(val);
            if (r.error) {
                folderInput.style.borderColor = "var(--danger)";
                setTimeout(() => (folderInput.style.borderColor = ""), 1200);
                return;
            }
            folderInput.value = "";
            loadFolders();
            refreshSidebar();
        });
    folderInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter")
            document.getElementById("configFolderAdd").click();
    });

    /* ── Ignore Patterns ── */

    async function loadIgnore() {
        const patterns = await api.getIgnorePatterns();
        const list = document.getElementById("configIgnoreList");
        if (!patterns.length) {
            list.innerHTML =
                '<div class="config-empty">No ignore patterns</div>';
            return;
        }
        list.innerHTML = patterns
            .map((p) => {
                return `<div class="config-item">
                    <div class="config-item-info" title="${escapeHtml(p)}">
                        <span class="config-item-name"><code>${escapeHtml(p)}</code></span>
                        <span class="config-badge config-badge-glob">glob</span>
                    </div>
                    <button class="config-remove" data-pattern="${escapeHtml(p)}" data-tip="Remove">${ICONS.unlink}</button>
                </div>`;
            })
            .join("");

        list.querySelectorAll(".config-remove[data-pattern]").forEach((btn) =>
            btn.addEventListener("click", async () => {
                await api.removeIgnore(btn.dataset.pattern);
                loadIgnore();
                refreshSidebar();
            }),
        );
    }

    const ignoreInput = document.getElementById("configIgnoreInput");
    document
        .getElementById("configIgnoreAdd")
        .addEventListener("click", async () => {
            const val = ignoreInput.value.trim();
            if (!val) return;
            const r = await api.addIgnore(val);
            if (!r.added && !r.error) {
                ignoreInput.style.borderColor = "var(--accent)";
                setTimeout(() => (ignoreInput.style.borderColor = ""), 1200);
            }
            ignoreInput.value = "";
            loadIgnore();
            refreshSidebar();
        });
    ignoreInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter")
            document.getElementById("configIgnoreAdd").click();
    });
}

/* ── WebSocket ─────────────────────────────────────────────────────── */

function initWS() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const statusEl = document.getElementById("connectionStatus");
    let retryDelay = 500;

    function setConnected(connected) {
        if (connected) {
            statusEl.classList.add("connected");
            statusEl.dataset.tip = "Live reload connected";
        } else {
            statusEl.classList.remove("connected");
            statusEl.dataset.tip = "Disconnected - reconnecting...";
        }
    }

    function connect() {
        const ws = new WebSocket(`${proto}//${location.host}`);

        ws.addEventListener("open", () => {
            retryDelay = 500;
            setConnected(true);
            // Refresh sidebar on reconnect to sync any changes made while disconnected
            refreshSidebar();
        });

        ws.addEventListener("close", () => {
            setConnected(false);
            setTimeout(connect, retryDelay);
            retryDelay = Math.min(retryDelay * 2, 5000);
        });

        ws.addEventListener("error", () => {
            setConnected(false);
        });

        ws.addEventListener("message", async (e) => {
            const msg = JSON.parse(e.data);
            console.log("[ws]", msg.type, msg.path || "");

            if (msg.type === "folders-changed") {
                refreshSidebar();
                return;
            }

            /* sidebar always refreshes on add/unlink so new files appear */
            if (msg.type === "add" || msg.type === "unlink") {
                refreshSidebar();
            }

            if (msg.folder !== activeFolderPath) return;

            /* normalize both paths for comparison */
            const msgPath = (msg.path || "").replace(/\\/g, "/");
            const curPath = (activeFilePath || "").replace(/\\/g, "/");

            if (msg.type === "unlink" && msgPath === curPath) {
                activeFilePath = null;
                document.getElementById("markdownBody").innerHTML =
                    '<div class="empty-state">File deleted</div>';
                return;
            }

            if (
                msgPath === curPath &&
                (msg.type === "change" || msg.type === "add")
            ) {
                const content = await api.file(
                    activeFolderPath,
                    activeFilePath,
                );
                if (content !== null) await renderMarkdown(content);
            }
        });
    }
    connect();
}

/* ── Init ──────────────────────────────────────────────────────────── */

document.addEventListener("DOMContentLoaded", () => {
    marked.use({ gfm: true, breaks: false, pedantic: false });
    initTheme();
    initSearch();
    initModal();
    initConfigPanel();
    initWS();
    initTooltips();
    refreshSidebar();
    // show home page when nothing selected
    if (!activeFolderPath && !activeFilePath) {
        document.getElementById("markdownBody").innerHTML = HOME_HTML;
    }
    document
        .getElementById("refreshBtn")
        .addEventListener("click", async () => {
            refreshSidebar();
            if (activeFolderPath && activeFilePath) {
                const content = await api.file(
                    activeFolderPath,
                    activeFilePath,
                );
                if (content !== null) await renderMarkdown(content);
            }
        });
});

/* ── Tooltip Positioning ───────────────────────────────────────────── */

function initTooltips() {
    let tipNode = null;
    let activeTarget = null;

    function showTip(target) {
        const text = target.getAttribute("data-tip");
        if (!text) return;
        if (!tipNode) {
            tipNode = document.createElement("div");
            tipNode.className = "floating-tooltip";
            document.body.appendChild(tipNode);
        }
        tipNode.textContent = text;
        tipNode.classList.add("show");
        positionTip(target);
        activeTarget = target;
    }

    function hideTip() {
        if (!tipNode) return;
        tipNode.classList.remove("show");
        activeTarget = null;
    }

    function positionTip(target) {
        if (!tipNode) return;
        const rect = target.getBoundingClientRect();
        const vw = Math.max(
            document.documentElement.clientWidth,
            window.innerWidth || 0,
        );
        const vh = Math.max(
            document.documentElement.clientHeight,
            window.innerHeight || 0,
        );
        const padding = 8;

        // prefer showing above the element if there's space, otherwise below
        tipNode.style.maxWidth = Math.min(420, vw - 40) + "px";

        // reset positioning to measure natural size
        tipNode.style.left = `0px`;
        tipNode.style.top = `0px`;
        tipNode.style.transform = `none`;
        const trect = tipNode.getBoundingClientRect();

        // center x above target, but clamp to viewport so tooltip doesn't overflow
        let x = rect.left + rect.width / 2;
        const half = trect.width / 2;
        const minX = padding + half;
        const maxX = vw - padding - half;
        if (x < minX) x = minX;
        if (x > maxX) x = maxX;
        tipNode.style.left = `${x}px`;

        // vertical placement: prefer below (bottom) if space, otherwise above; clamp to viewport
        if (rect.bottom + trect.height + padding < vh) {
            // below
            let y = rect.bottom + 6;
            if (y + trect.height > vh - padding)
                y = vh - padding - trect.height;
            tipNode.style.top = `${y}px`;
            tipNode.style.transform = `translate(-50%, 0)`;
        } else {
            // above
            let y = rect.top - 6;
            if (y - trect.height < padding) y = padding + trect.height;
            tipNode.style.top = `${y}px`;
            tipNode.style.transform = `translate(-50%, -100%)`;
        }
    }

    document.addEventListener("mouseover", (e) => {
        const el = e.target.closest("[data-tip]");
        if (el) showTip(el);
    });
    document.addEventListener("mouseout", (e) => {
        const el = e.target.closest("[data-tip]");
        if (!el) hideTip();
    });
    document.addEventListener("mousemove", (e) => {
        if (!activeTarget) return;
        // reposition while moving to better follow complex layouts
        positionTip(activeTarget);
    });
}
