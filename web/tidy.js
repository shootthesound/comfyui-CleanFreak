// comfyui-workflow-tidy — one-click workflow layout by node role.
//
// Adds a "Tidy by Role" item to the canvas right-click menu. Every node is
// classified into a role bucket (loaders / encoders / samplers / decoders /
// outputs / etc.) and laid out in width-aware columns left-to-right, in
// roughly the order the data flows through a typical workflow.
//
// Connections are never touched — LiteGraph links are by node id, so moving
// a node never breaks a wire.

import { app } from "/scripts/app.js";

// =====================================================================
// Role classification
//
// Order of buckets here = column order on the canvas (left → right by
// default; top → bottom in vertical mode).
// =====================================================================

const ROLES = [
    "loaders",        // Checkpoint / UNET / VAE / CLIP / ControlNet / LoRA loaders
    "image-input",    // LoadImage, EmptyLatentImage, LoadImageMask, etc.
    "prompts",        // Free-form text-storage nodes (e.g. PrimitiveNode strings, "ShowText")
    "encoders",       // CLIPTextEncode, T5TextEncode, anything that produces CONDITIONING
    "conditioning",   // ConditioningCombine, ConditioningSetTimestepRange, ReferenceLatent*, etc.
    "samplers",       // KSampler, KSamplerAdvanced, custom samplers
    "decoders",       // VAEDecode, VAEDecodeTiled, etc.
    "post",           // Image-domain post-processing (upscale, blur, sharpen, etc.)
    "outputs",        // SaveImage, PreviewImage, SaveAnimatedWEBP, etc.
    "misc",           // Anything we couldn't classify
];

// Group-card colours per role. Picked from a LiteGraph-friendly palette —
// muted enough to coexist with node body colours, distinct enough that you
// can read which column is which at a glance.
const ROLE_COLOURS = {
    "loaders":      "#c47b30",
    "image-input":  "#3f789e",
    "prompts":      "#598a4e",
    "encoders":     "#4a5fa1",
    "conditioning": "#8a3ea1",
    "samplers":     "#a13030",
    "decoders":     "#3e8f6f",
    "post":         "#2f8a8a",
    "outputs":      "#a8862a",
    "misc":         "#666666",
};

// Display-friendly title for each role group.
const ROLE_TITLES = {
    "loaders":      "Loaders",
    "image-input":  "Image / Latent Input",
    "prompts":      "Prompts",
    "encoders":     "Encoders",
    "conditioning": "Conditioning",
    "samplers":     "Samplers",
    "decoders":     "Decoders",
    "post":         "Image Post",
    "outputs":      "Output / Save",
    "misc":         "Misc",
};

// Exact-class fast-path table. Lower-cased class name → role.
const CLASS_OVERRIDES = {
    // Loaders
    "checkpointloadersimple": "loaders",
    "checkpointloader": "loaders",
    "unetloader": "loaders",
    "unetloadergguf": "loaders",
    "vaeloader": "loaders",
    "cliploader": "loaders",
    "dualcliploader": "loaders",
    "tripleeloader": "loaders",
    "controlnetloader": "loaders",
    "controlnetloaderadvanced": "loaders",
    "loraloader": "loaders",
    "loraloadermodelonly": "loaders",
    "loraloaderfindinglora": "loaders",
    "stylemodelloader": "loaders",
    "clipvisionloader": "loaders",
    "upscalemodelloader": "loaders",
    "diffusersmodelloader": "loaders",
    "ipadaptermodelloader": "loaders",
    "modelmergesimple": "loaders",

    // Image / latent input
    "loadimage": "image-input",
    "loadimagemask": "image-input",
    "emptylatentimage": "image-input",
    "emptylatent": "image-input",
    "emptysd3latentimage": "image-input",
    "emptylatentaudio": "image-input",
    "loadimagebatch": "image-input",
    "imageloader": "image-input",
    "primitivenode": "prompts",
    "primitive": "prompts",

    // Encoders → CONDITIONING
    "cliptextencode": "encoders",
    "cliptextencodeflux": "encoders",
    "cliptextencodesdxl": "encoders",
    "cliptextencodesd3": "encoders",
    "t5textencode": "encoders",
    "vaeencode": "encoders",
    "vaeencodeforinpaint": "encoders",
    "vaeencodetiled": "encoders",

    // Conditioning manipulation
    "conditioningcombine": "conditioning",
    "conditioningaverage": "conditioning",
    "conditioningconcat": "conditioning",
    "conditioningsetmask": "conditioning",
    "conditioningsetarea": "conditioning",
    "conditioningsetareastrength": "conditioning",
    "conditioningsettimesteprange": "conditioning",
    "conditioningzeroout": "conditioning",
    "controlnetapply": "conditioning",
    "controlnetapplyadvanced": "conditioning",
    "referencelatent": "conditioning",
    "referencelatentplus": "conditioning",
    "kleinreferencelatentplus": "conditioning",
    "fluxguidance": "conditioning",
    "modelsamplingflux": "conditioning",
    "modelsamplingsd3": "conditioning",

    // Samplers
    "ksampler": "samplers",
    "ksampleradvanced": "samplers",
    "ksamplerselect": "samplers",
    "samplercustom": "samplers",
    "samplercustomadvanced": "samplers",
    "samplerdpmpp_2m_sde_gpu": "samplers",
    "schedulerselect": "samplers",
    "basicguider": "samplers",
    "cfgguider": "samplers",
    "basicscheduler": "samplers",
    "splitsigmas": "samplers",
    "randomnoise": "samplers",
    "fluxsampler": "samplers",

    // Decoders
    "vaedecode": "decoders",
    "vaedecodetiled": "decoders",

    // Image post-processing
    "imageupscalewithmodel": "post",
    "upscaleimage": "post",
    "imageblur": "post",
    "imagesharpen": "post",
    "imageblend": "post",
    "imagecrop": "post",
    "imageresize": "post",
    "imagescale": "post",
    "imagescaleby": "post",

    // Output / preview
    "saveimage": "outputs",
    "previewimage": "outputs",
    "saveanimatedwebp": "outputs",
    "saveanimatedpng": "outputs",
    "savevideo": "outputs",
    "savelatent": "outputs",
};

// Fallback classifier: regex on (lowercased) class name + node category.
// Per-node user override (set from the preview modal) wins over everything
// else, so once a user re-assigns a node it stays in that bucket for the
// rest of the session.
function classifyNode(node) {
    if (node._tidy_role && ROLES.includes(node._tidy_role)) {
        return node._tidy_role;
    }
    const cls = (node.type || node.comfyClass || "").toLowerCase();

    // 1) Exact override
    if (CLASS_OVERRIDES[cls]) return CLASS_OVERRIDES[cls];

    // 2) ComfyUI category string. Many built-in nodes set this and it's our
    //    second-most-reliable signal.
    const cat = ((node.constructor && node.constructor.category) || "").toLowerCase();
    if (cat) {
        if (cat.includes("loader")) return "loaders";
        if (cat.includes("sampler") || cat.includes("sampling")) return "samplers";
        if (cat.includes("conditioning")) return "conditioning";
        if (cat.includes("latent")) return "image-input";
        if (cat.includes("image/upscaling") || cat.includes("postprocessing")) return "post";
        if (cat.includes("image")) {
            // could be input or post; lean on class name
            if (/load|empty/.test(cls)) return "image-input";
            return "post";
        }
    }

    // 3) Class-name regex fallbacks (matched in order)
    if (/^primitive/.test(cls)) return "prompts";
    if (/encode$|encoder/.test(cls)) return "encoders";
    if (/decode$|decoder/.test(cls)) return "decoders";
    if (/^save|^preview/.test(cls)) return "outputs";
    if (/sampler|scheduler|guider|noise/.test(cls)) return "samplers";
    if (/loader$|^load[A-Z]/.test(cls)) return "loaders";
    if (/conditioning|guidance|controlnet|reference/.test(cls)) return "conditioning";
    if (/upscale|blur|sharpen|resize|scale|crop|blend/.test(cls)) return "post";
    if (/^empty|^load/.test(cls)) return "image-input";

    return "misc";
}

// =====================================================================
// Layout
// =====================================================================

const COL_GAP = 60;          // px between columns
const ROW_GAP = 28;          // px between rows in a column
const TITLE_PAD = 30;        // extra space for node title bar
const ORIGIN_PAD = 50;       // top/left margin from existing graph origin

function topoOrderMap(graph) {
    // Use LiteGraph's executionOrder so nodes within a column arrange in
    // the order data flows through them.
    const order = graph.computeExecutionOrder ? graph.computeExecutionOrder(false, true) : graph._nodes.slice();
    const map = new Map();
    order.forEach((n, i) => map.set(n.id, i));
    return map;
}

function bucketize(nodes) {
    const buckets = Object.fromEntries(ROLES.map((r) => [r, []]));
    for (const n of nodes) {
        if (n._tidy_skip) continue;
        const role = classifyNode(n);
        (buckets[role] || buckets.misc).push(n);
    }
    return buckets;
}

function deleteAllGroups() {
    const graph = app.graph;
    if (!graph || !graph._groups) return 0;
    // Snapshot the array — graph.remove() mutates _groups while we iterate.
    const groups = graph._groups.slice();
    let removed = 0;
    for (const g of groups) {
        try { graph.remove(g); removed++; } catch (e) { /* noop */ }
    }
    return removed;
}

function createRoleGroups(buckets, usedRoles) {
    const graph = app.graph;
    if (!graph || typeof LiteGraph === "undefined" || !LiteGraph.LGraphGroup) return;

    const PAD = 24;            // padding between node and group border
    const TITLE_BAR = 36;      // extra space at top of group for the title

    for (const role of usedRoles) {
        const nodes = buckets[role];
        if (!nodes || nodes.length === 0) continue;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const n of nodes) {
            const x = n.pos[0];
            const y = n.pos[1];
            const w = nodeWidth(n);
            const h = nodeHeight(n);
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x + w > maxX) maxX = x + w;
            if (y + h > maxY) maxY = y + h;
        }
        if (!isFinite(minX)) continue;

        const group = new LiteGraph.LGraphGroup(ROLE_TITLES[role] || role);
        group.pos = [minX - PAD, minY - PAD - TITLE_BAR];
        group.size = [
            (maxX - minX) + PAD * 2,
            (maxY - minY) + PAD * 2 + TITLE_BAR,
        ];
        group.color = ROLE_COLOURS[role] || "#666";
        // LiteGraph stores font_size on the group; default looks tiny inside
        // the wide title bar, so bump it to something readable.
        group.font_size = 24;
        graph.add(group);
    }
}

function tidyByRole(orientation = "horizontal", opts = {}) {
    const { groups: addGroups = false } = opts;
    const graph = app.graph;
    if (!graph || !graph._nodes || !graph._nodes.length) return;

    // If we're going to add coloured role groups, wipe any pre-existing
    // groups first — otherwise old / stale group cards stack on every tidy.
    if (addGroups) deleteAllGroups();

    // Anchor at the bounding box origin of the current graph so the tidy
    // layout starts roughly where the workflow already lives — keeps the
    // user oriented instead of teleporting everything to (0, 0).
    let originX = Infinity, originY = Infinity;
    for (const n of graph._nodes) {
        if (n.pos) {
            originX = Math.min(originX, n.pos[0]);
            originY = Math.min(originY, n.pos[1]);
        }
    }
    if (!isFinite(originX)) originX = 0;
    if (!isFinite(originY)) originY = 0;

    const topoIdx = topoOrderMap(graph);
    const buckets = bucketize(graph._nodes);

    // Drop empty buckets so we don't reserve a gap for a column with nothing in it.
    const usedRoles = ROLES.filter((r) => buckets[r].length > 0);

    // Sort within each bucket by topological index, with output nodes pushed last
    // so SaveImage / PreviewImage land at the bottom of their column.
    for (const r of usedRoles) {
        buckets[r].sort((a, b) => {
            const aOut = a.type === "SaveImage" || a.type === "PreviewImage";
            const bOut = b.type === "SaveImage" || b.type === "PreviewImage";
            if (aOut !== bOut) return aOut ? 1 : -1;
            return (topoIdx.get(a.id) ?? 0) - (topoIdx.get(b.id) ?? 0);
        });
    }

    if (orientation === "vertical") {
        layoutVertical(buckets, usedRoles, originX, originY);
    } else {
        layoutHorizontal(buckets, usedRoles, originX, originY);
    }

    if (addGroups) createRoleGroups(buckets, usedRoles);

    app.graph.setDirtyCanvas(true, true);
}

function nodeWidth(n)  { return (n.size && n.size[0]) || 200; }
function nodeHeight(n) { return (n.size && n.size[1]) || 100; }

function layoutHorizontal(buckets, usedRoles, originX, originY) {
    // Each role is a column. Width = max node width in column. Nodes stack
    // vertically within the column, top-aligned at originY.
    let x = originX + ORIGIN_PAD;
    const yBase = originY + ORIGIN_PAD;
    for (const role of usedRoles) {
        const col = buckets[role];
        const colWidth = col.reduce((m, n) => Math.max(m, nodeWidth(n)), 0);

        let y = yBase;
        for (const n of col) {
            // Centre each node horizontally within the column (so wide and
            // narrow nodes in the same column line up visually).
            const nx = x + Math.round((colWidth - nodeWidth(n)) / 2);
            n.pos = [nx, y];
            y += nodeHeight(n) + ROW_GAP + TITLE_PAD;
        }
        x += colWidth + COL_GAP;
    }
}

function layoutVertical(buckets, usedRoles, originX, originY) {
    // Each role is a row. Height = max node height in row. Nodes stack
    // horizontally within the row, left-aligned at originX.
    const xBase = originX + ORIGIN_PAD;
    let y = originY + ORIGIN_PAD;
    for (const role of usedRoles) {
        const row = buckets[role];
        const rowHeight = row.reduce((m, n) => Math.max(m, nodeHeight(n)), 0);

        let x = xBase;
        for (const n of row) {
            const ny = y + Math.round((rowHeight - nodeHeight(n)) / 2);
            n.pos = [x, ny];
            x += nodeWidth(n) + COL_GAP;
        }
        y += rowHeight + ROW_GAP + TITLE_PAD;
    }
}

// =====================================================================
// Diagnostics — show the user what we classified things as before tidying
// =====================================================================

function showClassificationEditor() {
    const graph = app.graph;
    if (!graph || !graph._nodes || !graph._nodes.length) {
        alert("Workflow is empty.");
        return;
    }
    showEditorModal(graph._nodes);
}

function showEditorModal(nodes) {
    const backdrop = document.createElement("div");
    backdrop.style.cssText = `
        position: fixed; inset: 0; background: rgba(0,0,0,0.6);
        display: flex; align-items: center; justify-content: center;
        z-index: 10000; font-family: Arial, sans-serif;
    `;
    const modal = document.createElement("div");
    modal.style.cssText = `
        background: #2a2a2a; color: #ddd; border: 1px solid #555;
        border-radius: 8px; padding: 16px; width: 720px; max-width: 92vw;
        max-height: 84vh; display: flex; flex-direction: column; gap: 10px;
    `;

    const header = document.createElement("div");
    header.style.cssText = "font-size: 14px; font-weight: bold; color: #aaa;";
    header.textContent = "Tidy by Role — review & edit assignments";

    const hint = document.createElement("div");
    hint.style.cssText = "font-size: 11px; color: #888;";
    hint.textContent = "Change any node's role with the dropdown on its row. Edits stick for the rest of this session and are used by the next Tidy.";

    const list = document.createElement("div");
    list.style.cssText = `
        flex: 1; overflow: auto; background: #1a1a1a; border: 1px solid #444;
        border-radius: 4px; padding: 4px; font-size: 12px;
    `;

    // Sort rows by current role bucket so similar nodes land near each other.
    const rows = nodes
        .map((n) => ({ n, role: classifyNode(n) }))
        .sort((a, b) => {
            const ai = ROLES.indexOf(a.role);
            const bi = ROLES.indexOf(b.role);
            if (ai !== bi) return ai - bi;
            return (a.n.type || "").localeCompare(b.n.type || "");
        });

    let currentRoleHeader = null;

    for (const { n, role } of rows) {
        if (role !== currentRoleHeader) {
            currentRoleHeader = role;
            const sectionH = document.createElement("div");
            sectionH.style.cssText = `
                font-size: 11px; font-weight: bold; color: #aab; text-transform: uppercase;
                padding: 8px 8px 4px; letter-spacing: 0.5px;
            `;
            sectionH.dataset.tidyRoleHeader = role;
            sectionH.textContent = `${ROLE_TITLES[role] || role}`;
            list.appendChild(sectionH);
        }

        const row = document.createElement("div");
        row.style.cssText = `
            display: flex; align-items: center; gap: 10px;
            padding: 6px 8px; border-radius: 3px;
        `;
        row.dataset.tidyRow = "1";

        const label = document.createElement("div");
        label.style.cssText = "flex: 1; font-family: monospace; color: #ddd; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";
        const display = (n.title && n.title !== n.type) ? `${n.type} — ${n.title}` : (n.type || "(unknown)");
        label.textContent = display;
        label.title = display;

        const select = document.createElement("select");
        select.style.cssText = `
            background: #2a2a2a; color: #ddd; border: 1px solid #555;
            padding: 4px 8px; border-radius: 3px; font-size: 12px;
            min-width: 160px;
        `;
        for (const r of ROLES) {
            const opt = document.createElement("option");
            opt.value = r;
            opt.textContent = ROLE_TITLES[r] || r;
            if (r === role) opt.selected = true;
            select.appendChild(opt);
        }
        select.addEventListener("change", (e) => {
            const newRole = e.target.value;
            n._tidy_role = newRole;
        });

        row.appendChild(label);
        row.appendChild(select);
        list.appendChild(row);
    }

    if (rows.length === 0) {
        const empty = document.createElement("div");
        empty.style.cssText = "padding: 24px; color: #888; text-align: center;";
        empty.textContent = "(no nodes)";
        list.appendChild(empty);
    }

    const footer = document.createElement("div");
    footer.style.cssText = "display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap;";

    const close = () => backdrop.parentNode && backdrop.parentNode.removeChild(backdrop);

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Close";
    cancelBtn.style.cssText = "background: #444; color: #ddd; border: none; padding: 7px 14px; border-radius: 4px; cursor: pointer;";
    cancelBtn.addEventListener("click", close);

    const resetBtn = document.createElement("button");
    resetBtn.textContent = "Reset overrides";
    resetBtn.title = "Clear every per-node role override and re-classify from scratch";
    resetBtn.style.cssText = "background: #5a4444; color: #ddd; border: none; padding: 7px 14px; border-radius: 4px; cursor: pointer;";
    resetBtn.addEventListener("click", () => {
        for (const { n } of rows) delete n._tidy_role;
        close();
        showClassificationEditor();
    });

    const tidyHBtn = document.createElement("button");
    tidyHBtn.textContent = "Tidy (horizontal)";
    tidyHBtn.style.cssText = "background: #406688; color: #fff; border: none; padding: 7px 14px; border-radius: 4px; cursor: pointer;";
    tidyHBtn.addEventListener("click", () => { close(); tidyByRole("horizontal"); });

    const tidyVBtn = document.createElement("button");
    tidyVBtn.textContent = "Tidy (vertical)";
    tidyVBtn.style.cssText = "background: #406688; color: #fff; border: none; padding: 7px 14px; border-radius: 4px; cursor: pointer;";
    tidyVBtn.addEventListener("click", () => { close(); tidyByRole("vertical"); });

    const tidyHGBtn = document.createElement("button");
    tidyHGBtn.textContent = "Tidy + Groups (horizontal)";
    tidyHGBtn.style.cssText = "background: #4a8a4a; color: #fff; border: none; padding: 7px 14px; border-radius: 4px; cursor: pointer; font-weight: bold;";
    tidyHGBtn.addEventListener("click", () => { close(); tidyByRole("horizontal", { groups: true }); });

    const tidyVGBtn = document.createElement("button");
    tidyVGBtn.textContent = "Tidy + Groups (vertical)";
    tidyVGBtn.style.cssText = "background: #4a8a4a; color: #fff; border: none; padding: 7px 14px; border-radius: 4px; cursor: pointer; font-weight: bold;";
    tidyVGBtn.addEventListener("click", () => { close(); tidyByRole("vertical", { groups: true }); });

    footer.appendChild(cancelBtn);
    footer.appendChild(resetBtn);
    footer.appendChild(tidyHBtn);
    footer.appendChild(tidyVBtn);
    footer.appendChild(tidyHGBtn);
    footer.appendChild(tidyVGBtn);

    modal.appendChild(header);
    modal.appendChild(hint);
    modal.appendChild(list);
    modal.appendChild(footer);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
}

// =====================================================================
// Menu integration
// =====================================================================

app.registerExtension({
    name: "WorkflowTidy.ByRole",
    setup(app) {
        const orig = LGraphCanvas.prototype.getCanvasMenuOptions;
        LGraphCanvas.prototype.getCanvasMenuOptions = function () {
            const options = orig.apply(this, arguments);
            options.push(null); // separator
            options.push({
                content: "✨ Tidy by Role (horizontal)",
                callback: () => tidyByRole("horizontal"),
            });
            options.push({
                content: "✨ Tidy by Role (vertical)",
                callback: () => tidyByRole("vertical"),
            });
            options.push({
                content: "✨ Tidy by Role + Groups (horizontal)",
                callback: () => tidyByRole("horizontal", { groups: true }),
            });
            options.push({
                content: "✨ Tidy by Role + Groups (vertical)",
                callback: () => tidyByRole("vertical", { groups: true }),
            });
            options.push({
                content: "✨ Tidy by Role — Delete all groups",
                callback: () => {
                    const n = deleteAllGroups();
                    app.graph.setDirtyCanvas(true, true);
                    if (typeof window !== "undefined") {
                        // Tiny inline confirmation; alert is sufficient for one-off.
                        alert(`Deleted ${n} group${n === 1 ? "" : "s"}.`);
                    }
                },
            });
            options.push({
                content: "✨ Tidy by Role — review & edit assignments…",
                callback: () => showClassificationEditor(),
            });
            return options;
        };
    },
});
