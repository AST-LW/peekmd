"use strict";

/* ── State ─────────────────────────────────────────────────────────── */

let activeFolderPath = null;
let activeFilePath = null;
const collapsedNodes = new Set();

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
  <div>No folders linked.<br>Click <strong>+</strong> to add one, or run<br><code>peekmd link ./docs</code></div>
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
                return `<div class="file-item${active}" data-folder="${folder}" data-path="${fullPath}" style="padding-left:${14 + depth * 16}px">${ICONS.file} ${name}</div>`;
            }

            const key = folder + ":" + fullPath;
            const collapsed = collapsedNodes.has(key) ? " collapsed" : "";
            return `<div class="tree-dir${collapsed}" data-node-key="${key}">
            <div class="tree-dir-header" style="padding-left:${10 + depth * 16}px">${ICONS.treeChevron} ${ICONS.treeFolder} <span>${name}</span></div>
            <div class="tree-dir-children">${renderTree(tree[name], folder, fullPath, depth + 1)}</div>
        </div>`;
        })
        .join("");
}

async function refreshSidebar() {
    const list = document.getElementById("folderList");
    const groups = await api.folders();

    if (!groups.length) {
        list.innerHTML = EMPTY_STATE;
        return;
    }

    list.innerHTML = groups
        .map((g) => {
            const collapsed = collapsedNodes.has("root:" + g.folder)
                ? " collapsed"
                : "";
            const files = g.files.length
                ? renderTree(buildTree(g.files), g.folder, "", 0)
                : '<div class="file-item" style="opacity:.4;cursor:default;">No .md files</div>';

            return `<div class="folder-group${collapsed}" data-folder="${g.folder}">
            <div class="folder-header">
                <div class="folder-label">${ICONS.folder} <span title="${g.folder}">${g.name}</span></div>
                <button class="folder-unlink" data-unlink="${g.folder}" title="Unlink folder">${ICONS.unlink}</button>
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
                document.getElementById("markdownBody").innerHTML =
                    '<div class="empty-state">Select a file to preview</div>';
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

/* ── WebSocket ─────────────────────────────────────────────────────── */

function initWS() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    let retryDelay = 500;

    function connect() {
        const ws = new WebSocket(`${proto}//${location.host}`);

        ws.addEventListener("open", () => {
            retryDelay = 500;
        });

        ws.addEventListener("message", async (e) => {
            const msg = JSON.parse(e.data);

            if (msg.type === "folders-changed") {
                refreshSidebar();
                return;
            }
            if (msg.folder !== activeFolderPath) return;

            if (msg.type === "unlink" && msg.path === activeFilePath) {
                activeFilePath = null;
                document.getElementById("markdownBody").innerHTML =
                    '<div class="empty-state">File deleted</div>';
            } else if (msg.path === activeFilePath) {
                const content = await api.file(
                    activeFolderPath,
                    activeFilePath,
                );
                if (content !== null) await renderMarkdown(content);
            }
            refreshSidebar();
        });

        ws.addEventListener("close", () => {
            setTimeout(connect, retryDelay);
            retryDelay = Math.min(retryDelay * 2, 5000);
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
    initWS();
    refreshSidebar();
    document
        .getElementById("refreshBtn")
        .addEventListener("click", refreshSidebar);
});
