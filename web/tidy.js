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
function classifyNode(node) {
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

function tidyByRole(orientation = "horizontal") {
    const graph = app.graph;
    if (!graph || !graph._nodes || !graph._nodes.length) return;

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

function showClassificationReport() {
    const graph = app.graph;
    if (!graph || !graph._nodes || !graph._nodes.length) {
        alert("Workflow is empty.");
        return;
    }
    const buckets = bucketize(graph._nodes);
    const lines = [];
    for (const role of ROLES) {
        const items = buckets[role];
        if (!items || items.length === 0) continue;
        lines.push(`${role.toUpperCase()} (${items.length}):`);
        for (const n of items) {
            lines.push(`  • ${n.type}${n.title && n.title !== n.type ? ` — ${n.title}` : ""}`);
        }
        lines.push("");
    }
    showReportModal(lines.join("\n"));
}

function showReportModal(body) {
    const backdrop = document.createElement("div");
    backdrop.style.cssText = `
        position: fixed; inset: 0; background: rgba(0,0,0,0.6);
        display: flex; align-items: center; justify-content: center;
        z-index: 10000; font-family: Arial, sans-serif;
    `;
    const modal = document.createElement("div");
    modal.style.cssText = `
        background: #2a2a2a; color: #ddd; border: 1px solid #555;
        border-radius: 8px; padding: 16px; width: 560px; max-width: 90vw;
        max-height: 80vh; display: flex; flex-direction: column; gap: 10px;
    `;
    const header = document.createElement("div");
    header.style.cssText = "font-size: 14px; font-weight: bold; color: #aaa;";
    header.textContent = "Tidy by Role — classification preview";
    const pre = document.createElement("pre");
    pre.style.cssText = `
        flex: 1; overflow: auto; background: #1a1a1a; border: 1px solid #444;
        border-radius: 4px; padding: 12px; font-size: 12px;
        font-family: monospace; white-space: pre-wrap; margin: 0;
    `;
    pre.textContent = body || "(no nodes)";
    const footer = document.createElement("div");
    footer.style.cssText = "display: flex; gap: 8px; justify-content: flex-end;";
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "Close";
    closeBtn.style.cssText = `
        background: #444; color: #ddd; border: none; padding: 6px 14px;
        border-radius: 4px; cursor: pointer;
    `;
    const tidyBtn = document.createElement("button");
    tidyBtn.textContent = "Tidy now (horizontal)";
    tidyBtn.style.cssText = `
        background: #4a6; color: #111; border: none; padding: 6px 14px;
        border-radius: 4px; cursor: pointer; font-weight: bold;
    `;
    const close = () => backdrop.parentNode && backdrop.parentNode.removeChild(backdrop);
    closeBtn.addEventListener("click", close);
    tidyBtn.addEventListener("click", () => {
        close();
        tidyByRole("horizontal");
    });
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    footer.appendChild(closeBtn);
    footer.appendChild(tidyBtn);
    modal.appendChild(header);
    modal.appendChild(pre);
    modal.appendChild(footer);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
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
                content: "✨ Tidy by Role — preview classification…",
                callback: () => showClassificationReport(),
            });
            return options;
        };
    },
});
