<h1 align="center">CleanFreak — for ComfyUI</h1>

<p align="center">
  One-click <strong>tidy by role</strong> for any ComfyUI workflow.<br>
  Loaders go in one column. Encoders in the next. Then samplers, decoders, outputs. Width-aware. Coloured group cards. Connections preserved.<br>
  <em>Ships pre-classified for the entire stock node set plus the most-used community packs — Impact-Pack, controlnet_aux, rgthree-comfy, VideoHelperSuite, IPAdapter_plus, WAS Node Suite, comfyui-easy-use, RES4LYF, comfyui-dynamicprompts, comfyui-ollama, comfyui-automaticcfg, Comfyroll, and the entire shootthesound pack family. Edit anything you don't like and save it — the classifier learns over time.</em>
</p>

<p align="center">
  <a href="https://buymeacoffee.com/lorasandlenses"><img src="https://img.shields.io/badge/Buy%20me%20a%20coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black" alt="Buy Me A Coffee"></a>
</p>

---

### Why I built this

Every ComfyUI workflow I open ends up looking like a plate of spaghetti within a few iterations. Existing arrange tools either reorder by execution depth (breaks when nodes have similar depth) or just snap-to-grid (doesn't actually organise anything). I wanted something that groups nodes by what they *are* — load model here, encode prompts there, sample here, decode there, save there — so the same workflow shape always lays out the same way regardless of how I built it.

---

### What it does

Right-click on the canvas (empty space, not on a node) and pick one of:

- **✨ Tidy by Role (horizontal)** — columns left-to-right, no groups
- **✨ Tidy by Role (vertical)** — rows top-to-bottom, no groups
- **✨ Tidy by Role + Groups (horizontal)** — columns left-to-right, plus a colour-coded group card around each role bucket
- **✨ Tidy by Role + Groups (vertical)** — same, vertical
- **✨ Tidy by Role — Delete all groups** — wipe every group on the canvas without touching node positions
- **✨ Tidy by Role — Unpack subgraphs/groups + Tidy + Groups (horizontal/vertical)** — first flatten every container node (modern **subgraphs** via `graph.unpackSubgraph()` AND legacy **group nodes** via `convertToNodes()`), iterating until nothing remains so nested containers fully flatten, then tidy with coloured group cards.
- **✨ Tidy by Role — Unpack all subgraphs / group nodes (no tidy)** — flatten every container node without re-laying anything out.
- **✨ Tidy by Role — review & edit assignments…** — open an interactive modal listing every node grouped by its current bucket, each with a dropdown to re-assign its role. Per-node overrides stick for the rest of the session and are used by every subsequent Tidy. The footer has Tidy / Tidy + Groups buttons for both orientations, an **Unpack subgraphs / group nodes first** toggle, plus Save / Reset / Forget-saved buttons.

The two `+ Groups` variants delete any pre-existing groups before drawing fresh ones, so re-tidying never stacks stale groups on top of new ones.

Every node in the workflow is classified into one of these buckets:

| Role | Examples |
|---|---|
| `loaders` | CheckpointLoaderSimple, UNETLoader, VAELoader, CLIPLoader, LoraLoader, ControlNetLoader, … |
| `image-input` | LoadImage, EmptyLatentImage, LoadImageMask, … |
| `prompts` | PrimitiveNode (string), ShowText, … |
| `encoders` | CLIPTextEncode, T5TextEncode, VAEEncode, … |
| `conditioning` | ConditioningCombine, ConditioningSetTimestepRange, ControlNetApply, ReferenceLatent+, FluxGuidance, … |
| `samplers` | KSampler, KSamplerAdvanced, SamplerCustom, BasicScheduler, RandomNoise, … |
| `decoders` | VAEDecode, VAEDecodeTiled |
| `post` | ImageUpscaleWithModel, ImageBlur, ImageScale, … |
| `outputs` | SaveImage, PreviewImage, SaveAnimatedWEBP, … |
| `misc` | Anything we couldn't classify — gets its own column |

Each non-empty bucket becomes a column (or row, in vertical mode). Column width = the widest node in that column; nodes are centred horizontally within their column so wide and narrow nodes line up neatly.

Within each column, nodes are sorted by ComfyUI's execution order, with `SaveImage`/`PreviewImage` pushed to the bottom of their column.

---

### How classification works

Five-step lookup chain (highest priority wins):

1. **Per-node session override** — anything you picked in this session's editor modal.
2. **Per-class user override (saved to disk)** — anything you've ever pressed **Save assignments** on. Stored at `<ComfyUI>/user/cleanfreak/role_overrides.json`. The file accumulates over time, so the more workflows you tidy the more nodes the classifier knows about by default.
3. **Built-in class override table.** A lookup of every common class name → role. Out of the box this covers:
   - **The entire stock ComfyUI node set** — checkpoint/UNET/VAE/CLIP/ControlNet/LoRA loaders, every text encoder, conditioning manipulators (combine / concat / set timestep / set mask / set area / FluxGuidance / model-sampling), KSampler + KSamplerAdvanced + custom-sampler / scheduler / guider / noise nodes, VAEDecode tiled/untiled, image input / load / empty latent, save / preview / animated webp / animated png / save video / save latent, image upscale / blur / sharpen / blend / crop / resize / scale.
   - **A wide swathe of community packs**:
     - `comfyui-Impact-Pack` (every detailer / regional sampler / SEGS pipeline / scheduler / SAM loader / wildcard encoder / sender-receiver classified)
     - `comfyui_controlnet_aux` (all ~50 preprocessors → `post`)
     - `rgthree-comfy` (Power LoRA Loader, Power Prompt variants, Image Resize, Image Comparer, KSampler Config, Seed)
     - `comfyui-videohelpersuite` (every `VHS_Load*` → `image-input`, `VideoCombine` → `outputs`, batched VAE → `encoders`/`decoders`)
     - `ComfyUI_IPAdapter_plus` (model/embed/insightface loaders → `loaders`, every `IPAdapter*` applier → `conditioning`)
     - `was-node-suite` (every checkpoint / lora / model loader → `loaders`, every Image filter / blend / crop / paste / mask op → `post`, every Text * → `prompts`, KSampler (WAS) / KSampler Cycle → `samplers`, Image Save / Write to GIF/Video / Send HTTP → `outputs`)
     - `comfyui-easy-use` (every `easy *Loader` → `loaders`, every `easy kSampler*` / `easy preSampling*` / `easy detailerFix` → `samplers`, every `easy ipadapterApply*` / `easy instantIDApply*` / `easy pulIDApply*` → `conditioning`, `easy prompt*` / `easy wildcards*` → `prompts`, `easy imageSave` / `easy showAnything` → `outputs`)
     - `RES4LYF` (every `Clown*Sampler*` / `Shark*Sampler*` / `Re*Patcher` / `ModelTimestepPatcher` → `samplers`, every `Clown*Guide*` / `Clown*Style*` / `ClownInpaint*` / `ClownRegionalConditioning*` / `Conditioning*` → `conditioning`, every `TextBox*` → `prompts`, regex catches `Sigmas *` → `samplers` and `Frames *` → `post`)
     - `comfyui-dynamicprompts` (`DPCombinatorial`, `DPMagicPrompt`, `DPRandomGenerator`, etc. → `prompts`)
     - `comfyui-ollama` (all `Ollama*` LLM nodes → `prompts`, since their text output is typically wired into a `CLIPTextEncode`)
     - `comfyui-automaticcfg` (every `Automatic CFG *` model patch + `SAG delayed activation` + `Temperature *` + `Zero Uncond CFG *` → `conditioning`)
     - `ComfyUI_Comfyroll_CustomNodes` (CR LoRA Stack / CR Apply LoRA Stack → `loaders`, CR Apply ControlNet / Multi-ControlNet → `conditioning`, CR Image Output → `outputs`, CR Upscale Image / CR Halftone / CR Vignette → `post`)
     - `ComfyUI-LTXVideo` + LTX-Tricks + KJNodes LTXV-subset — every `LTXV*Sampler` / `LTXFlowEdit*` / `LTX*ODESampler` / `LTX*ModelSamplingPred` → `samplers`; every guide / patch / attention override / `STG*Guider` / `Multimodal*Guider` / `LTX*Audio*Mask` → `conditioning`; `LTXVTiledVAEDecode` → `decoders`; LTXVQ8/Gemma/Prompt-Enhancer/LowVRAM-* loaders → `loaders`; `LTXVGemmaEnhancePrompt` → `prompts`; `LTXVSelectLatents` / `ImageToCPU` → `post`.
   - **Every node in `shootthesound`'s pack family** — Finding LoRA, Reference Latent+, Realtime LoRA (selective + analyzer loaders + model-layer editors + every trainer variant), Clippy Reborn, Image of the Day, Model Diff to LoRA, Wan I2V Control, LongLook.
4. **Node category.** Many ComfyUI nodes set a `CATEGORY` like `"loaders"`, `"sampling"`, `"image/upscaling"`, etc. We use that as a strong fallback signal.
5. **Class-name regex.** Generic patterns: ends in `Encode` → encoders, ends in `Decode` → decoders, contains `Sample`/`Scheduler` → samplers, starts with `Load` → loaders, starts with `Save`/`Preview` → outputs, contains `Conditioning`/`Guidance`/`ControlNet` → conditioning, etc.

Anything that survives all five falls into the `misc` column.

The **review & edit assignments** modal lists every node grouped under its current bucket, with a per-row dropdown to re-assign. Footer buttons:

- **Tidy / Tidy + Groups (horizontal/vertical)** — apply with current assignments
- **Save assignments** — promote every assignment in the list to a per-class default and write to `role_overrides.json`. Future workflows that contain the same classes will use these assignments automatically.
- **Reset session edits** — drop the per-node session overrides on every visible node and re-classify from scratch.
- **Forget saved** — wipe the entire `role_overrides.json`. Built-in classification rules still apply.

---

### Group cards

The `+ Groups` variants draw a coloured group card around each non-empty role bucket after tidying. Each role has its own muted-but-distinguishable colour so a glance tells you which column is which. The card title is the role's display name (`Loaders`, `Encoders`, `Conditioning`, `Samplers`, …).

Re-tidying with `+ Groups` always wipes existing groups first, so stale groups never accumulate. If you only want to nuke the groups (without re-arranging nodes), use **Delete all groups**.

---

### Connections are never touched

ComfyUI links are stored by node id (not by position), so changing `node.pos = [x, y]` never breaks a wire. This pack only ever writes to `node.pos` and to the graph's groups list. No links, no inputs, no outputs, nothing else.

---

### HTTP routes (for the curious)

Three routes live under `/cleanfreak/`:

- `GET  /cleanfreak/overrides` — returns `{ overrides: {ClassName: role, …} }`
- `POST /cleanfreak/overrides` — body `{ overrides: {…} }`, replaces saved overrides with the supplied map
- `POST /cleanfreak/overrides/clear` — wipes saved overrides (no body)

Storage: `<ComfyUI>/user/cleanfreak/role_overrides.json`. Live-editable on disk; restart ComfyUI to pick up manual edits.

---

### Quick start

1. Drop the `comfyui-CleanFreak` folder into `ComfyUI/custom_nodes/`.
2. Restart ComfyUI (or reload the browser tab if hot-reloading is on).
3. Right-click on empty canvas space → pick a tidy option.

No node to add to your workflow. No new inputs/outputs. It's purely an editor convenience.

---

### Layout details

- **Horizontal mode** — roles become columns, left to right in this order: `loaders → image-input → prompts → encoders → conditioning → samplers → decoders → post → outputs → misc`. Nodes stack vertically within each column.
- **Vertical mode** — roles become rows, top to bottom in the same order. Nodes stack horizontally within each row.
- **Column width** = `max(nodeWidth)` of every node in that column. Nodes narrower than the column are horizontally centred inside it.
- **Row height** = `max(nodeHeight)` of every node in that row.
- **Anchor** — the layout starts at the top-left of your current bounding box, not at canvas (0, 0). So tidying a workflow that lives in some random corner of the canvas keeps it roughly where you left it.
- **Empty buckets** are skipped — no wasted columns.

---

### Limitations / honest notes

- **Custom nodes that don't match any rule** end up in `misc`. The classification table is exhaustive for stock and very common packs but can't be exhaustive for everything. Run the **preview classification** modal first if your workflow uses unusual nodes — anything in `misc` that should be elsewhere is something we can add to the override table.
- **No grouping support yet.** ComfyUI groups (the coloured rectangles you can lasso) are ignored. Nodes inside groups are tidied along with everything else, breaking out of their group box. If grouping support matters to you, open an issue.
- **No animation.** Tidying happens in one frame. If you want to undo, ComfyUI's native undo (Ctrl+Z) covers it.

---

### Support

If this saves you re-arranging time, consider supporting development:

<a href="https://buymeacoffee.com/lorasandlenses"><img src="https://img.shields.io/badge/Buy%20me%20a%20coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black" alt="Buy Me A Coffee"></a>
