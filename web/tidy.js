// comfyui-CleanFreak — one-click workflow layout by node role.
//
// Adds a "Tidy by Role" item set to the canvas right-click menu. Every node
// is classified into a role bucket (loaders / encoders / samplers / decoders
// / outputs / etc.) and laid out in width-aware columns left-to-right, in
// roughly the order the data flows through a typical workflow.
//
// User-level overrides — assignments the user picks in the editor modal and
// then "Save"s — get persisted to the backend's
//   <ComfyUI>/user/cleanfreak/role_overrides.json
// file via the /cleanfreak/overrides routes. Subsequent sessions and
// workflows pick those up automatically, so the classifier learns from the
// user over time and gradually knows about more nodes than the built-in
// override table covers.
//
// Connections are never touched — LiteGraph links are by node id, so moving
// a node never breaks a wire.

import { app } from "/scripts/app.js";

const ROUTE_BASE = "/cleanfreak";

// Module-level cache of user role overrides keyed by node class name.
// Populated lazily on first use and refreshed on every successful save.
let USER_OVERRIDES = {};
let USER_OVERRIDES_LOADED = false;
let USER_OVERRIDES_LOAD_PROMISE = null;

function ensureOverridesLoaded() {
    if (USER_OVERRIDES_LOADED) return Promise.resolve(USER_OVERRIDES);
    if (USER_OVERRIDES_LOAD_PROMISE) return USER_OVERRIDES_LOAD_PROMISE;
    USER_OVERRIDES_LOAD_PROMISE = (async () => {
        try {
            const res = await fetch(`${ROUTE_BASE}/overrides`);
            if (res.ok) {
                const data = await res.json();
                if (data && typeof data.overrides === "object" && data.overrides) {
                    USER_OVERRIDES = data.overrides;
                }
            }
        } catch (e) {
            console.warn("[cleanfreak] failed to load user overrides:", e);
        } finally {
            USER_OVERRIDES_LOADED = true;
            USER_OVERRIDES_LOAD_PROMISE = null;
        }
        return USER_OVERRIDES;
    })();
    return USER_OVERRIDES_LOAD_PROMISE;
}

async function saveUserOverrides(overrides) {
    try {
        const res = await fetch(`${ROUTE_BASE}/overrides`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ overrides }),
        });
        if (!res.ok) return false;
        const data = await res.json();
        if (data && typeof data.overrides === "object" && data.overrides) {
            USER_OVERRIDES = data.overrides;
            USER_OVERRIDES_LOADED = true;
        }
        return true;
    } catch (e) {
        console.warn("[cleanfreak] failed to save user overrides:", e);
        return false;
    }
}

async function clearUserOverridesOnDisk() {
    try {
        const res = await fetch(`${ROUTE_BASE}/overrides/clear`, { method: "POST" });
        if (!res.ok) return false;
        USER_OVERRIDES = {};
        USER_OVERRIDES_LOADED = true;
        return true;
    } catch (e) {
        console.warn("[cleanfreak] failed to clear user overrides:", e);
        return false;
    }
}

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

    // --- ComfyUI core extras (anything in nodes.py / comfy_extras not
    // already covered above) ---
    "checkpointsave": "outputs",
    "modelsave": "outputs",
    "vaesave": "outputs",
    "clipsave": "outputs",
    "imageonlycheckpointsave": "outputs",
    "previewany": "outputs",
    "clipmergeadd": "loaders",
    "clipmergesimple": "loaders",
    "clipmergesubtract": "loaders",
    "clipsetlastlayer": "loaders",
    "clipvisionloader": "loaders",
    "clipvisionencode": "encoders",
    "diffcontrolnetloader": "loaders",
    "diffusersloader": "loaders",
    "gligenloader": "loaders",
    "gligentextboxapply": "conditioning",
    "imageonlycheckpointloader": "loaders",
    "loadimageoutput": "image-input",
    "loadlatent": "image-input",
    "emptyimage": "image-input",
    "webcamcapture": "image-input",
    "loraloaderbypass": "loaders",
    "loraloaderbypassmodelonly": "loaders",
    "modelpatchloader": "loaders",
    // Model-merge family — every variant goes in loaders since they produce
    // a (modified) MODEL.
    "modelmergeadd": "loaders",
    "modelmergeblocks": "loaders",
    "modelmergesubtract": "loaders",
    "modelmergeauraflow": "loaders",
    "modelmergecosmos14b": "loaders",
    "modelmergecosmos7b": "loaders",
    "modelmergecosmospredict2_14b": "loaders",
    "modelmergecosmospredict2_2b": "loaders",
    "modelmergeflux1": "loaders",
    "modelmergeltxv": "loaders",
    "modelmergemochipreview": "loaders",
    "modelmergeqwenimage": "loaders",
    "modelmergesd1": "loaders",
    "modelmergesd2": "loaders",
    "modelmergesd35_large": "loaders",
    "modelmergesd3_2b": "loaders",
    "modelmergesdxl": "loaders",
    "modelmergewan2_1": "loaders",
    // Model-sampling family — these patch the model's sampling behaviour.
    // Existing modelsamplingflux / modelsamplingsd3 were classified as
    // conditioning; keep the family consistent.
    "modelsamplingauraflow": "conditioning",
    "modelsamplingcontinuousedm": "conditioning",
    "modelsamplingcontinuousv": "conditioning",
    "modelsamplingdiscrete": "conditioning",
    "modelsamplingstablecascade": "conditioning",
    "modelcomputedtype": "conditioning",
    // Conditioning extras
    "conditioningsetareapercentage": "conditioning",
    "conditioningsetareapercentagevideo": "conditioning",
    "inpaintmodelconditioning": "conditioning",
    "stylemodelapply": "conditioning",
    "usostylereference": "conditioning",
    "qwenimagediffsynthcontrolnet": "conditioning",
    "zimagefuncontrolnet": "conditioning",
    "rescalecfg": "conditioning",
    "videolinearcfgguidance": "conditioning",
    "videotrianglecfgguidance": "conditioning",
    "svd_img2vid_conditioning": "conditioning",
    "setlatentnoisemask": "conditioning",
    "unclipconditioning": "conditioning",
    "unclipcheckpointloader": "loaders",
    // Sampler / scheduler extras
    "ltxvlatentupsampler": "samplers",
    // Latent ops → post-processing of the latent (not creation)
    "latentblend": "post",
    "latentcomposite": "post",
    "latentcrop": "post",
    "latentflip": "post",
    "latentfrombatch": "post",
    "latentrotate": "post",
    "latentupscale": "post",
    "latentupscaleby": "post",
    "repeatlatentbatch": "post",
    // Image ops
    "imagebatch": "post",
    "imageinvert": "post",
    "imagepadforoutpaint": "post",

    // shootthesound packs — Realtime LoRA (selective + analyzer loaders +
    // model-layer editors, all of which modify the active model)
    "applytrainedlora": "loaders",
    "loraloaderwithanalysis": "loaders",
    "sdxlselectiveloraloader": "loaders",
    "zimageselectiveloraloader": "loaders",
    "fluxselectiveloraloader": "loaders",
    "wanselectiveloraloader": "loaders",
    "qwenselectiveloraloader": "loaders",
    "scheduledloraloader": "loaders",
    "fluxanalyzerselectiveloaderv2": "loaders",
    "fluxklein4banalyzerselectiveloaderv2": "loaders",
    "fluxklein9banalyzerselectiveloaderv2": "loaders",
    "qwenanalyzerselectiveloaderv2": "loaders",
    "sdxlanalyzerselectiveloaderv2": "loaders",
    "wananalyzerselectiveloaderv2": "loaders",
    "zimageanalyzerselectiveloaderv2": "loaders",
    "fluxmodellayereditor": "loaders",
    "sdxlmodellayereditor": "loaders",
    "sd15modellayereditor": "loaders",
    "zimagemodellayereditor": "loaders",
    "wanmodellayereditor": "loaders",
    "qwenmodellayereditor": "loaders",

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

    // shootthesound packs — image-input loaders
    "clippyrebornimageloader": "image-input",
    "imageofdayloader": "image-input",

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

    // shootthesound packs — Wan I2V conditioning extras + LongLook (Wan
    // motion / continuation / FreeLong-related) modify CONDITIONING
    "wani2vconditioningmaskpro": "conditioning",
    "wancontinuationconditioning": "conditioning",
    "wanmotionscale": "conditioning",
    "wanmotionscaleadvanced": "conditioning",
    "wanfreelong": "conditioning",
    "wanfreelongenforcer": "conditioning",

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

    // shootthesound packs — frame manipulation
    "dropfirstframes": "post",

    // Output / preview
    "saveimage": "outputs",
    "previewimage": "outputs",
    "saveanimatedwebp": "outputs",
    "saveanimatedpng": "outputs",
    "savevideo": "outputs",
    "savelatent": "outputs",

    // shootthesound packs — anything that produces a saved file (LoRA
    // extraction, in-Comfy LoRA training)
    "modeldifftolora": "outputs",
    "realtimeloratrainer": "outputs",
    "sdxlloratrainer": "outputs",
    "sd15loratrainer": "outputs",
    "musubizimageloratrainer": "outputs",
    "musubizimagebaseloratrainer": "outputs",
    "musubifluxkleinloratrainer": "outputs",
    "musubiqwenimageloratrainer": "outputs",
    "musubiqwenimageeditloratrainer": "outputs",
    "musubiwanloratrainer": "outputs",

    // ====================================================================
    // Top-5 community packs — pre-classified so a fresh CleanFreak install
    // tidies popular workflows out of the box.
    // ====================================================================

    // --- ComfyUI-Impact-Pack (ltdrdata) ---
    // Detection / segmentation samplers (faces, regions, tiles)
    "facedetailer": "samplers",
    "facedetailerpipe": "samplers",
    "detailerforeach": "samplers",
    "detailerforeachpipe": "samplers",
    "detailerforeachdebug": "samplers",
    "detailerforeachdebugpipe": "samplers",
    "detailerforeachpipeforanimatediff": "samplers",
    "detailerforeachautoretry": "samplers",
    "maskdetailerpipe": "samplers",
    "segsdetailer": "samplers",
    "segsdetailerforanimatediff": "samplers",
    "segsupscaler": "samplers",
    "segsupscalerpipe": "samplers",
    "iterativeimageupscale": "samplers",
    "iterativelatentupscale": "samplers",
    "regionalsampler": "samplers",
    "regionalsampleradvanced": "samplers",
    "twosamplersformask": "samplers",
    "twoadvancedsamplersformask": "samplers",
    "ksamplerprovider": "samplers",
    "ksampleradvancedprovider": "samplers",
    "impactksamplerbasicpipe": "samplers",
    "impactksampleradvancedbasicpipe": "samplers",
    "tiledksamplerprovider": "samplers",
    "alignyourstepsscheduler": "samplers",
    "gitsscheduler": "samplers",
    "optimalstepsscheduler": "samplers",
    "ltxvscheduler": "samplers",
    "bnk_tiledksampler": "samplers",
    // Loaders the pack provides
    "samloader": "loaders",
    "esam_modelloader_zho": "loaders",
    "loraloaderblockweight //inspire": "loaders",
    "nunchakufluxloraloader": "loaders",
    // Conditioning helpers
    "regionalprompt": "conditioning",
    "combineregionalprompts": "conditioning",
    "impactcombineconditionings": "conditioning",
    "impactconcatconditionings": "conditioning",
    "impactnegativeconditioningplaceholder": "conditioning",
    "impactcontrolnetapplysegs": "conditioning",
    "impactcontrolnetapplyadvancedsegs": "conditioning",
    "impactipadapterapplysegs": "conditioning",
    "acn_advancedcontrolnetapply": "conditioning",
    // Encoders
    "impactwildcardencode": "encoders",
    "impactwildcardprocessor": "encoders",
    // Outputs / preview
    "previewbridge": "outputs",
    "previewbridgelatent": "outputs",
    "imagesender": "outputs",
    "latentsender": "outputs",
    "impactvaluesender": "outputs",
    "segspreview": "outputs",
    "segspreviewcnet": "outputs",
    // Image input
    "imagereceiver": "image-input",
    "latentreceiver": "image-input",
    "impactvaluereceiver": "image-input",
    "bnk_noisylatentimage": "image-input",
    "bnk_injectnoise": "image-input",
    // Post
    "imageupscalewithmodel": "post",
    "latentpixelscale": "post",
    "tilepreprocessor": "post",

    // --- comfyui_controlnet_aux ---
    // Every preprocessor produces a hint image used by ControlNet — they're
    // image-domain transformations applied between an input image and the
    // ControlNet apply node. "post" is the closest existing bucket.
    "aio_preprocessor": "post",
    "controlnetpreprocessorselector": "post",
    "executeallcontrolnetpreprocessors": "post",
    "cannyedgepreprocessor": "post",
    "lineartpreprocessor": "post",
    "lineartstandardpreprocessor": "post",
    "anylineartpreprocessor_aux": "post",
    "animelineartpreprocessor": "post",
    "fakescribblepreprocessor": "post",
    "scribblepreprocessor": "post",
    "scribble_pidinet_preprocessor": "post",
    "scribble_xdog_preprocessor": "post",
    "hedpreprocessor": "post",
    "pidinetpreprocessor": "post",
    "teedpreprocessor": "post",
    "depthanythingpreprocessor": "post",
    "depthanythingv2preprocessor": "post",
    "metric_depthanythingv2preprocessor": "post",
    "zoe_depthanythingpreprocessor": "post",
    "zoe-depthmappreprocessor": "post",
    "midas-depthmappreprocessor": "post",
    "leres-depthmappreprocessor": "post",
    "metric3d-depthmappreprocessor": "post",
    "meshgraphormer-depthmappreprocessor": "post",
    "openposepreprocessor": "post",
    "dwpreprocessor": "post",
    "densepospreprocessor": "post",
    "denseposepreprocessor": "post",
    "animalposepreprocessor": "post",
    "renderpeoplekps": "post",
    "renderanimalkps": "post",
    "facialpartcoloringfromposekps": "post",
    "upperbodytrackingfromposekps": "post",
    "savepokpsasjsonfile": "post",
    "savep0sekpsasjsonfile": "post",
    "saveposekpsasjsonfile": "post",
    "mediapipe-facemeshpreprocessor": "post",
    "animeface_semsegpreprocessor": "post",
    "semsegpreprocessor": "post",
    "uniformer-semsegpreprocessor": "post",
    "oneformer-coco-semsegpreprocessor": "post",
    "oneformer-ade20k-semsegpreprocessor": "post",
    "sampreprocessor": "post",
    "binarypreprocessor": "post",
    "colorpreprocessor": "post",
    "shufflepreprocessor": "post",
    "tilepreprocessor": "post",
    "ttplanet_tilegf_preprocessor": "post",
    "ttplanet_tilesimple_preprocessor": "post",
    "pyracannypreprocessor": "post",
    "diffusionedge_preprocessor": "post",
    "manga2anime_lineart_preprocessor": "post",
    "inpaintpreprocessor": "post",
    "midas-normalmappreprocessor": "post",
    "bae-normalmappreprocessor": "post",
    "dsine-normalmappreprocessor": "post",
    "metric3d-normalmappreprocessor": "post",
    "m-lsdpreprocessor": "post",
    "unimatch_optflowpreprocessor": "post",
    "maskoptflow": "post",
    "controlnetauxsimpleaddtext": "post",
    "hintimageenchance": "post",
    "imageintensitydetector": "post",
    "imageluminancedetector": "post",
    // Resolution helpers — image-input slot fits best
    "imagegenresolutionfromimage": "image-input",
    "imagegenresolutionfromlatent": "image-input",
    "pixelperfectresolution": "image-input",

    // --- rgthree-comfy ---
    // rgthree class names include the parenthesised "(rgthree)" namespace;
    // ComfyUI's frontend uses them verbatim as node.type, so we lower-case
    // here to match the lookup.
    "lora loader stack (rgthree)": "loaders",
    "power lora loader (rgthree)": "loaders",
    "sdxl empty latent image (rgthree)": "image-input",
    "image or latent size (rgthree)": "image-input",
    "image comparer (rgthree)": "outputs",
    "image inset crop (rgthree)": "post",
    "image resize (rgthree)": "post",
    "ksampler config (rgthree)": "samplers",
    "power prompt (rgthree)": "prompts",
    "power prompt - simple (rgthree)": "prompts",
    "sdxl power prompt - positive (rgthree)": "prompts",
    "sdxl power prompt - simple / negative (rgthree)": "prompts",
    "seed (rgthree)": "samplers",
    "power primitive (rgthree)": "prompts",

    // --- comfyui-videohelpersuite ---
    "vhs_loadvideo": "image-input",
    "vhs_loadvideopath": "image-input",
    "vhs_loadvideoffmpeg": "image-input",
    "vhs_loadvideoffmpegpath": "image-input",
    "vhs_loadimages": "image-input",
    "vhs_loadimagespath": "image-input",
    "vhs_loadimagepath": "image-input",
    "vhs_loadaudio": "image-input",
    "vhs_loadaudioupload": "image-input",
    "vhs_videocombine": "outputs",
    "vhs_vaedecodebatched": "decoders",
    "vhs_vaeencodebatched": "encoders",
    "vhs_videoinfo": "post",
    "vhs_videoinfoloaded": "post",
    "vhs_videoinfosource": "post",
    "vhs_pruneoutputs": "post",
    "vhs_selectimages": "post",
    "vhs_selectlatents": "post",
    "vhs_selectmasks": "post",
    "vhs_selecteverynthimage": "post",
    "vhs_selecteverynthlatent": "post",
    "vhs_selecteverynthmask": "post",
    "vhs_splitimages": "post",
    "vhs_splitlatents": "post",
    "vhs_splitmasks": "post",
    "vhs_mergeimages": "post",
    "vhs_mergelatents": "post",
    "vhs_mergemasks": "post",
    "vhs_duplicateimages": "post",
    "vhs_duplicatelatents": "post",
    "vhs_duplicatemasks": "post",
    "vhs_unbatch": "post",

    // --- ComfyUI_IPAdapter_plus (cubiq) ---
    "ipadaptermodelloader": "loaders",
    "ipadapterunifiedloader": "loaders",
    "ipadapterunifiedloadercommunity": "loaders",
    "ipadapterunifiedloaderfaceid": "loaders",
    "ipadapterinsightfaceloader": "loaders",
    "ipadapterloadembeds": "loaders",
    "ipadapter": "conditioning",
    "ipadapteradvanced": "conditioning",
    "ipadapterbatch": "conditioning",
    "ipadaptertiled": "conditioning",
    "ipadaptertiledbatch": "conditioning",
    "ipadapterfaceid": "conditioning",
    "ipadapterfaceidkolors": "conditioning",
    "ipaadapterfaceidbatch": "conditioning",
    "ipadapterembeds": "conditioning",
    "ipadapterembedsbatch": "conditioning",
    "ipadapterencoder": "conditioning",
    "ipadapterclipvisionenhancer": "conditioning",
    "ipadapterclipvisionenhancerbatch": "conditioning",
    "ipadaptercombineembeds": "conditioning",
    "ipadaptercombineparams": "conditioning",
    "ipadaptercombineweights": "conditioning",
    "ipadapterfromparams": "conditioning",
    "ipadapterms": "conditioning",
    "ipadapternoise": "conditioning",
    "ipadapterpromptscheduleffromweightsstrategy": "conditioning",
    "ipadapterregionalconditioning": "conditioning",
    "ipadapterstylecomposition": "conditioning",
    "ipadapterstylecompositionbatch": "conditioning",
    "ipadapterprecisecomposition": "conditioning",
    "ipadapterprecisecompositionbatch": "conditioning",
    "ipadapterprecisestyletransfer": "conditioning",
    "ipadapterprecisestyletransferbatch": "conditioning",
    "ipadapterweights": "conditioning",
    "ipadapterweightsfromstrategy": "conditioning",
    "ipadaptersaveembeds": "outputs",
    "prepimageforclipvision": "post",

    // --- comfyui-ollama ---
    // LLM nodes that produce text. Classified as prompts because their
    // output is typically fed straight into a CLIPTextEncode node.
    "ollamachat": "prompts",
    "ollamagenerate": "prompts",
    "ollamagenerateadvance": "prompts",
    "ollamageneratev2": "prompts",
    "ollamavision": "prompts",
    "ollamaloadcontext": "prompts",
    "ollamasavecontext": "prompts",
    "ollamaoptionsv2": "prompts",
    "ollamaconnectivityv2": "prompts",

    // --- comfyui-dynamicprompts ---
    // Prompt-generation utilities (combinatorial, jinja, magic-prompt, …).
    "dpcombinatorialgenerator": "prompts",
    "dpfeelinglucky": "prompts",
    "dpjinja": "prompts",
    "dpmagicprompt": "prompts",
    "dpoutput": "prompts",
    "dprandomgenerator": "prompts",

    // --- was-ns (WAS Node Suite) ---
    // Class names contain spaces and parentheses; matched verbatim.
    "checkpoint loader": "loaders",
    "checkpoint loader (simple)": "loaders",
    "diffusers model loader": "loaders",
    "diffusers hub model down-loader": "loaders",
    "lora loader": "loaders",
    "load lora": "loaders",
    "upscale model loader": "loaders",
    "midas model loader": "loaders",
    "blip model loader": "loaders",
    "clipseg model loader": "loaders",
    "sam model loader": "loaders",
    "unclip checkpoint loader": "loaders",
    "image load": "image-input",
    "load image batch": "image-input",
    "image history loader": "image-input",
    "image blank": "image-input",
    "constant number": "image-input",
    "random number": "image-input",
    "seed": "image-input",
    "cliptextencode (nsp)": "encoders",
    "text to conditioning": "encoders",
    "ksampler (was)": "samplers",
    "ksampler cycle": "samplers",
    "image save": "outputs",
    "save text file": "outputs",
    "image send http": "outputs",
    "write to gif": "outputs",
    "write to video": "outputs",
    "video dump frames": "outputs",
    "create video from path": "outputs",
    "create morph image": "outputs",
    "create morph image from path": "outputs",
    "export api": "outputs",
    "blip analyze image": "prompts",
    "prompt multiple styles selector": "prompts",
    "prompt styles selector": "prompts",
    "text string": "prompts",
    "text multiline": "prompts",
    "text multiline (code compatible)": "prompts",
    "text concatenate": "prompts",
    "text random prompt": "prompts",
    "text random line": "prompts",
    "text load line from file": "prompts",
    "text shuffle": "prompts",
    "text find and replace": "prompts",
    "text find and replace input": "prompts",
    "text find and replace by dictionary": "prompts",
    "text parse a1111 embeddings": "prompts",
    "text parse noodle soup prompts": "prompts",
    "image resize": "post",
    "image crop face": "post",
    "image crop location": "post",
    "image crop square location": "post",
    "image bounds": "post",
    "inset image bounds": "post",
    "image flip": "post",
    "image rotate": "post",
    "image rotate hue": "post",
    "image padding": "post",
    "image stitch": "post",
    "image tiled": "post",
    "image transpose": "post",
    "image batch": "post",
    "image bloom filter": "post",
    "image canny filter": "post",
    "image chromatic aberration": "post",
    "image dragan photography filter": "post",
    "image edge detection filter": "post",
    "image film grain": "post",
    "image filter adjustments": "post",
    "image generate gradient": "post",
    "image gradient map": "post",
    "image high pass filter": "post",
    "image levels adjustment": "post",
    "image lucy sharpen": "post",
    "image median filter": "post",
    "image mix rgb channels": "post",
    "image monitor effects filter": "post",
    "image nova filter": "post",
    "image perlin noise": "post",
    "image perlin power fractal": "post",
    "image pixelate": "post",
    "image power noise": "post",
    "image rembg (remove background)": "post",
    "image remove background (alpha)": "post",
    "image remove color": "post",
    "image ssao (ambient occlusion)": "post",
    "image ssdo (direct occlusion)": "post",
    "image seamless texture": "post",
    "image select channel": "post",
    "image select color": "post",
    "image shadows and highlights": "post",
    "image style filter": "post",
    "image threshold": "post",
    "image voronoi noise filter": "post",
    "image fdof filter": "post",
    "image blend": "post",
    "image blend by mask": "post",
    "image blending mode": "post",
    "image displacement warp": "post",
    "image paste crop": "post",
    "image paste crop by location": "post",
    "image paste face": "post",
    "image color palette": "post",
    "bounded image blend": "post",
    "bounded image blend with mask": "post",
    "bounded image crop": "post",
    "bounded image crop with mask": "post",
    "latent batch": "post",
    "latent noise injection": "post",
    "latent upscale by factor (was)": "post",
    "blend latents": "post",
    "midas depth approximation": "post",
    "midas mask image": "post",
    "convert masks to images": "post",
    "tensor batch to image": "post",
    "image to latent mask": "post",
    "image to noise": "post",
    "images to linear": "post",
    "images to rgb": "post",
    // WAS — number/seed/value primitives (often feed sampler seeds, sizes,
    // strengths). Group as image-input so they sit alongside the latent /
    // image source nodes that consume them.
    "number counter": "image-input",
    "number input condition": "image-input",
    "number multiple of": "image-input",
    "number operation": "image-input",
    "number pi": "image-input",
    "number to float": "image-input",
    "number to int": "image-input",
    "number to seed": "image-input",
    "number to string": "image-input",
    "number to text": "image-input",
    "image size to number": "image-input",
    "latent size to number": "image-input",
    "image to seed": "image-input",
    "image aspect ratio": "image-input",
    // WAS — text/string conversion utilities
    "string to text": "prompts",
    "text to string": "prompts",
    "text to number": "prompts",
    "boolean to text": "prompts",
    "text add token by input": "prompts",
    "text add tokens": "prompts",
    "text compare": "prompts",
    "text contains": "prompts",
    "text find": "prompts",
    "text dictionary convert": "prompts",
    "text dictionary get": "prompts",
    "text dictionary keys": "prompts",
    "text dictionary new": "prompts",
    "text dictionary to text": "prompts",
    "text dictionary update": "prompts",
    "text file history loader": "prompts",
    "text list": "prompts",
    "text list concatenate": "prompts",
    "text list to text": "prompts",
    "text parse tokens": "prompts",
    "text sort": "prompts",
    "text string truncate": "prompts",
    "text to console": "outputs",
    // WAS — masks (post-processing of mask data)
    "convert masks to images": "post",
    "tensor batch to image": "post",
    "create grid image": "post",
    "create grid image from batch": "post",
    "midas depth approximation": "post",
    "midas mask image": "post",
    "clipsg2": "post",
    "clipseg2": "post",
    "clipseg masking": "post",
    "clipseg batch masking": "post",
    "sam image mask": "post",
    "sam parameters": "post",
    "sam parameters combine": "post",
    "image bounds": "post",
    "image color palette": "post",
    "image analyze": "post",
    "mask arbitrary region": "post",
    "mask batch": "post",
    "mask batch to mask": "post",
    "mask ceiling region": "post",
    "mask crop dominant region": "post",
    "mask crop minority region": "post",
    "mask crop region": "post",
    "mask dilate region": "post",
    "mask dominant region": "post",
    "mask erode region": "post",
    "mask fill holes": "post",
    "mask floor region": "post",
    "mask gaussian region": "post",
    "mask invert": "post",
    "mask minority region": "post",
    "mask paste region": "post",
    "mask rect area": "post",
    "mask rect area (advanced)": "post",
    "mask smooth region": "post",
    "mask threshold region": "post",
    "masks add": "post",
    "masks combine batch": "post",
    "masks combine regions": "post",
    "masks subtract": "post",
    "hsl to hex": "post",
    "hex to hsl": "post",
    // WAS — Random number / Seed / cache (input-ish utilities)
    "constant number": "image-input",
    "random number": "image-input",
    "load text file": "image-input",
    "load cache": "image-input",
    "cache node": "image-input",

    // --- comfyui-easy-use (yolain) ---
    // "easy *" wrappers — most are loaders, samplers, conditioning appliers,
    // or prompt utilities. Matched lower-case (with the space verbatim).
    "easy a1111loader": "loaders",
    "easy comfyloader": "loaders",
    "easy fullloader": "loaders",
    "easy fluxloader": "loaders",
    "easy cascadeloader": "loaders",
    "easy hunyuanditloader": "loaders",
    "easy kolorsloader": "loaders",
    "easy mochiloader": "loaders",
    "easy pixartloader": "loaders",
    "easy sv3dloader": "loaders",
    "easy svdloader": "loaders",
    "easy zero123loader": "loaders",
    "easy controlnetloader": "loaders",
    "easy controlnetloaderadv": "loaders",
    "easy lllitelloader": "loaders",
    "easy llliteloader": "loaders",
    "easy ckptnames": "loaders",
    "easy controlnetnames": "loaders",
    "easy loranames": "loaders",
    "easy lorastack": "loaders",
    "easy loraswitcher": "loaders",
    "easy samloaderpipe": "loaders",
    "brushnetloader": "loaders",
    "controlnetloaderadvanced": "loaders",
    "instantidmodelloader": "loaders",
    "pulidevaclipoader": "loaders",
    "pulidevaclioloader": "loaders",
    "pulidevaclipl​oader": "loaders",
    "pulidinsightfaceloader": "loaders",
    "pulidmodelloader": "loaders",
    "samloader": "loaders",
    "ultralyticsdetectorprovider": "loaders",
    "easy ksampler": "samplers",
    "easy ksamplercustom": "samplers",
    "easy ksamplerdownscaleunet": "samplers",
    "easy ksamplerinpainting": "samplers",
    "easy ksamplerlayerdiffusion": "samplers",
    "easy ksamplersdturbo": "samplers",
    "easy ksamplertiled": "samplers",
    "easy fullksampler": "samplers",
    "easy cascadeksampler": "samplers",
    "easy fullcascadeksampler": "samplers",
    "easy detailerfix": "samplers",
    "easy predetailerfix": "samplers",
    "easy premaskdetailerfix": "samplers",
    "easy unsampler": "samplers",
    "easy hiresfix": "samplers",
    "easy presampling": "samplers",
    "easy presamplingadvanced": "samplers",
    "easy presamplingcascade": "samplers",
    "easy presamplingcustom": "samplers",
    "easy presamplingdynamiccfg": "samplers",
    "easy presamplinglayerdiffusion": "samplers",
    "easy presamplinglayerdiffusionaddtl": "samplers",
    "easy presamplingnoisein": "samplers",
    "easy presamplingsdturbo": "samplers",
    "easy globalseed": "samplers",
    "easy seed": "samplers",
    "easy seedlist": "samplers",
    "easy controlnetstack": "conditioning",
    "easy controlnetstackapply": "conditioning",
    "easy negative": "conditioning",
    "easy positive": "conditioning",
    "applyinstantid": "conditioning",
    "applypulid": "conditioning",
    "applypulidadvanced": "conditioning",
    "easy instantidapply": "conditioning",
    "easy instantidapplyadv": "conditioning",
    "easy ipadapterapply": "conditioning",
    "easy ipadapterapplyadv": "conditioning",
    "easy ipadapterapplyembeds": "conditioning",
    "easy ipadapterapplyencoder": "conditioning",
    "easy ipadapterapplyfaceidkolors": "conditioning",
    "easy ipadapterapplyfromparams": "conditioning",
    "easy ipadapterapplyregional": "conditioning",
    "easy ipadapterstylecomposition": "conditioning",
    "easy pulidapply": "conditioning",
    "easy pulidapplyadv": "conditioning",
    "easy iclightapply": "conditioning",
    "easy applybrushnet": "conditioning",
    "easy applyfoocusinpaint": "conditioning",
    "easy applyfooocusinpaint": "conditioning",
    "easy applyinpaint": "conditioning",
    "easy applypowerpaint": "conditioning",
    "easy injectnoisetolatent": "conditioning",
    "differentialdiffusion": "conditioning",
    "patchmodeladddownscale": "conditioning",
    "scaledsoftcontrolnetweights": "conditioning",
    "dynamicthresholdingfull": "conditioning",
    "brushnet": "conditioning",
    "easy imagesave": "outputs",
    "easy savetext": "outputs",
    "easy savetextlazy": "outputs",
    "easy saveimagelazy": "outputs",
    "easy showanything": "outputs",
    "easy showanythinglazy": "outputs",
    "easy showloadersettingsnames": "outputs",
    "easy showtensorshape": "outputs",
    "easy showspenttime": "outputs",
    "easy prompt": "prompts",
    "easy promptawait": "prompts",
    "easy promptconcat": "prompts",
    "easy promptline": "prompts",
    "easy promptlist": "prompts",
    "easy promptreplace": "prompts",
    "easy stylesselector": "prompts",
    "easy wildcards": "prompts",
    "easy wildcardsmatrix": "prompts",
    "easy loranpromptapply": "prompts",
    "easy lorapromptapply": "prompts",
    "easy joycaption2api": "prompts",
    "easy joycaption3api": "prompts",
    "easy poseeditor": "prompts",
    "easy portraitmaster": "prompts",
    "smz cliptextencode": "encoders",
    "easy loadimagebase64": "image-input",
    "easy loadimagesforloop": "image-input",
    "easy imagebatchotimagelist": "image-input",
    "easy imagebatchtoimagelist": "image-input",
    "easy imagelisttoimagebatch": "image-input",
    "easy imagecountindirectory": "image-input",
    "easy imagescountindirectory": "image-input",
    "easy imagescaledown": "post",
    "easy imagescaledownby": "post",
    "easy imagescaledowntosize": "post",
    "easy imagescaletonormpixels": "post",
    "easy imagesize": "post",
    "easy imagesizebylongerside": "post",
    "easy imagesizebyside": "post",
    "easy imagesplitgrid": "post",
    "easy imagesplitlist": "post",
    "easy imagesplittiles": "post",
    "easy imagetilesfrombatch": "post",
    "easy imagetobase64": "post",
    "easy imagetomask": "post",
    "easy imageuncropfrombbox": "post",
    "easy imagesplitimage": "post",
    "easy joinimagebatch": "post",
    "easy makeimageforiclora": "post",
    "easy imagecolormatch": "post",
    "easy imageconcat": "post",
    "easy imagecount": "post",
    "easy imagecropfrommask": "post",
    "easy imagedetailtransfer": "post",
    "easy imageinsetcrop": "post",
    "easy imageinterrogator": "post",
    "easy imagepixelperfect": "post",
    "easy imageratio": "post",
    "easy imagerembg": "post",
    "easy pixels": "post",
    "easy humansegmentation": "post",
    "imagescale": "post",
    "feathermask": "post",
    "solidmask": "post",
    "facedetailer": "samplers",
    "maskdetailerpipe": "samplers",

    // --- RES4LYF ---
    // Mostly samplers + sigma scheduling + conditioning patches. Big buckets:
    "clownmodelloader": "loaders",
    "fluxloader": "loaders",
    "sd35loader": "loaders",
    "clownsampler": "samplers",
    "clownsamplerselector_beta": "samplers",
    "clownsampleradvanced": "samplers",
    "clownsampler_beta": "samplers",
    "clownsampleradvanced_beta": "samplers",
    "legacy_clownsampler": "samplers",
    "clownsharksampler": "samplers",
    "clownsharksamplerautomation": "samplers",
    "clownsharksamplerautomation_advanced": "samplers",
    "clownsharksamplerguide": "samplers",
    "clownsharksamplerguides": "samplers",
    "clownsharksampleroptions": "samplers",
    "clownsharksampler_beta": "samplers",
    "clownsharkchainsampler_beta": "samplers",
    "legacy_clownsharksampler": "samplers",
    "legacy_clownsharksamplerguides": "samplers",
    "sharksampler": "samplers",
    "sharksampleradvanced_beta": "samplers",
    "sharksampler_beta": "samplers",
    "sharkchainsampler_beta": "samplers",
    "sharkoptions_beta": "samplers",
    "sharkoptions_guidecond_beta": "samplers",
    "sharkoptions_guideconds_beta": "samplers",
    "sharkoptions_guiderinput": "samplers",
    "sharkoptions_startstep_beta": "samplers",
    "sharkoptions_ultracascade_latent_beta": "samplers",
    "ultrasharksampler": "samplers",
    "ultrasharksampler tiled": "samplers",
    "legacy_sharksampler": "samplers",
    "bongsampler": "samplers",
    "advancednoise": "samplers",
    "seedgenerator": "samplers",
    "modelsamplingadvanced": "samplers",
    "modelsamplingadvancedresolution": "samplers",
    "modeltimesteppatcher": "samplers",
    "samplerolptions_garbagecollection": "samplers",
    "sampleroptions_garbagecollection": "samplers",
    "sampleroptions_timestepscaling": "samplers",
    "clownscheduler": "samplers",
    "constant scheduler": "samplers",
    "tan scheduler": "samplers",
    "tan scheduler 2": "samplers",
    "tan scheduler 2 simple": "samplers",
    "linear quadratic advanced": "samplers",
    "reaurapatcher": "samplers",
    "reaurapatcheradvanced": "samplers",
    "rechromapatcher": "samplers",
    "rechromapatcheradvanced": "samplers",
    "refluxpatcher": "samplers",
    "refluxpatcheradvanced": "samplers",
    "rehidreampatcher": "samplers",
    "rehidreampatcheradvanced": "samplers",
    "reltxvpatcher": "samplers",
    "reltxvpatcheradvanced": "samplers",
    "rereduxpatcher": "samplers",
    "resd35patcher": "samplers",
    "resd35patcheradvanced": "samplers",
    "resdpatcher": "samplers",
    "rewanpatcher": "samplers",
    "rewanpatcheradvanced": "samplers",
    "torchcompilemodelaura": "samplers",
    "torchcompilemodelfluxadv": "samplers",
    "torchcompilemodelsd35": "samplers",
    "torchcompilemodels": "samplers",
    "fluxorthocfgpatcher": "samplers",
    "layerpatcher": "samplers",
    "prepforunsampling": "samplers",
    // Sigmas — too many to enumerate; rely on regex fallback for "sigmas *"
    "sigmaspreview": "outputs",
    "sigmasschedulepreview": "outputs",
    "unetsave": "outputs",
    "latent display state info": "outputs",
    // Conditioning patches
    "cliptextencodefluxunguided": "encoders",
    "vaeencodeadvanced": "encoders",
    "stablecascade_stagec_vaeencode_exact": "encoders",
    "vaestyletransferlatent": "encoders",
    "latentupscalewithvae": "decoders",
    "clownguide_beta": "conditioning",
    "clownguide_mean_beta": "conditioning",
    "clownguide_style_beta": "conditioning",
    "clownguide_style_edgewidth": "conditioning",
    "clownguide_style_tilesize": "conditioning",
    "clownguide_adain_mmdit_beta": "conditioning",
    "clownguide_attninj_mmdit_beta": "conditioning",
    "clownguide_frequencyseparation": "conditioning",
    "clownguide_stylenorm_advanced_hidream": "conditioning",
    "clownguidesab_beta": "conditioning",
    "clownguides_beta": "conditioning",
    "clownguides_sync": "conditioning",
    "clownguides_sync_advanced": "conditioning",
    "clowninpaint": "conditioning",
    "clowninpaintsimple": "conditioning",
    "clownregionalconditioning": "conditioning",
    "clownregionalconditioning2": "conditioning",
    "clownregionalconditioning3": "conditioning",
    "clownregionalconditioning_ab": "conditioning",
    "clownregionalconditioning_abc": "conditioning",
    "clownregionalconditionings": "conditioning",
    "clownstyle_attn_mmdit": "conditioning",
    "clownstyle_attn_unet": "conditioning",
    "clownstyle_block_mmdit": "conditioning",
    "clownstyle_block_unet": "conditioning",
    "clownstyle_boost": "conditioning",
    "clownstyle_mmdit": "conditioning",
    "clownstyle_resblock_unet": "conditioning",
    "clownstyle_spatialblock_unet": "conditioning",
    "clownstyle_transformerblock_unet": "conditioning",
    "clownstyle_unet": "conditioning",
    "clownoptions_automation_beta": "conditioning",
    "clownoptions_combine": "conditioning",
    "clownoptions_cycles_beta": "conditioning",
    "clownoptions_detailboost_beta": "conditioning",
    "clownoptions_extraoptions_beta": "conditioning",
    "clownoptions_flowguide": "conditioning",
    "clownoptions_frameweights": "conditioning",
    "clownoptions_implicitsteps_beta": "conditioning",
    "clownoptions_momentum_beta": "conditioning",
    "clownoptions_sde_beta": "conditioning",
    "clownoptions_sde_mask_beta": "conditioning",
    "clownoptions_sde_noise": "conditioning",
    "clownoptions_sigmascaling_beta": "conditioning",
    "clownoptions_stepsize_beta": "conditioning",
    "clownoptions_swapsampler_beta": "conditioning",
    "clownoptions_tile_advanced_beta": "conditioning",
    "clownoptions_tile_beta": "conditioning",
    "conditioningadd": "conditioning",
    "conditioningaveragescheduler": "conditioning",
    "conditioningbatch4": "conditioning",
    "conditioningbatch8": "conditioning",
    "conditioningdownsample (t5)": "conditioning",
    "conditioningmultiply": "conditioning",
    "conditioningorthocollin": "conditioning",
    "conditioningtruncate": "conditioning",
    "conditioningzeroandtruncate": "conditioning",
    "conditioning recast fp64": "conditioning",
    "conditioningtobase64": "conditioning",
    "base64toconditioning": "conditioning",
    "fluxguidancedisable": "conditioning",
    "stablecascade_stageb_conditioning64": "conditioning",
    "stylemodelapplystyle": "conditioning",
    "crossattn_erasereplace_hidream": "conditioning",
    "temporalcrossattnmask": "conditioning",
    "temporalsplitattnmask": "conditioning",
    "temporalsplitattnmask (midframe)": "conditioning",
    "temporalmaskgenerator": "conditioning",
    // Image input / latent prep
    "emptylatentimage64": "image-input",
    "emptylatentimagecustom": "image-input",
    "setimagesize": "image-input",
    "setimagesizewithscale": "image-input",
    // Text / prompts
    "textbox1": "prompts",
    "textbox2": "prompts",
    "textbox3": "prompts",
    "textboxconcatenate": "prompts",
    "textconcatenate": "prompts",
    "textloadfile": "prompts",
    "textshuffle": "prompts",
    "textshuffleandtruncate": "prompts",
    "texttruncatetokens": "prompts",

    // --- comfyui-automaticcfg ---
    // Model patches that change CFG / attention behaviour during sampling.
    // Closest bucket is "conditioning" since they reshape how conditioning
    // is consumed at inference time.
    // --- ComfyUI-KJNodes (kijai) — full pack ---
    // Loaders
    "checkpointloaderkj": "loaders",
    "diffusionmodelloaderkj": "loaders",
    "vaeloaderkj": "loaders",
    "ggufloaderkj": "loaders",
    "diffusionmodelselector": "loaders",
    "loadresadapternormalization": "loaders",
    "ditblockloraloader": "loaders",
    "fluxblockloraselect": "loaders",
    "hunyuanvideoblockloraselect": "loaders",
    "wan21blockloraselect": "loaders",
    "intrinsic_lora_sampling": "loaders",
    "downloadandloadclipseg": "loaders",
    // Samplers / sigmas / noise
    "generatenoise": "samplers",
    "flipsigmasadjusted": "samplers",
    "injectnoisetolatent": "samplers",
    "customsigmas": "samplers",
    "floattosigmas": "samplers",
    "sigmastofloat": "samplers",
    "stablezero123_batchschedule": "samplers",
    "sv3d_batchschedule": "samplers",
    // Conditioning / model patches / attention overrides / RoPE / CFG
    "conditioningmulticombine": "conditioning",
    "conditioningsetmaskandcombine": "conditioning",
    "conditioningsetmaskandcombine3": "conditioning",
    "conditioningsetmaskandcombine4": "conditioning",
    "conditioningsetmaskandcombine5": "conditioning",
    "condpassthrough": "conditioning",
    "wanimagetovideosvipro": "conditioning",
    "stylemodelapplyadvanced": "conditioning",
    "gligentextboxapplybatchcoords": "conditioning",
    "scheduledcfgguidance": "conditioning",
    "applyriflexrope_hunuyanvideo": "conditioning",
    "applyriflexrope_wanvideo": "conditioning",
    "wanvideoteacachekj": "conditioning",
    "wanvideoenhanceavideokj": "conditioning",
    "skiplayerguidancewanvideo": "conditioning",
    "wanvideonag": "conditioning",
    "hunyuanvideoencodekeyframesto­cond": "conditioning",
    "hunyuanvideoencodekeyframestocond": "conditioning",
    "cfgzerostarandinit": "conditioning",
    "modelpatchtorchsettings": "conditioning",
    "patchmodelpatcherorder": "conditioning",
    "latentinpaintttm": "conditioning",
    "nabla_attentionkj": "conditioning",
    "leapfusionhunyuani2vpatcher": "conditioning",
    "differentialdiffusionadvanced": "conditioning",
    "ltxvenhanceavideokj": "conditioning",
    "createinstancediffusiontracking": "conditioning",
    "appendinstancediffusiontracking": "conditioning",
    "drawinstancediffusiontracking": "conditioning",
    "customcontrolnetweightsfluxfromlist": "conditioning",
    "setshakkerlabsunioncontrolnettype": "conditioning",
    "checkpointperturbweights": "conditioning",
    "pathchsageattentionkj": "conditioning",
    "torchcompilemodelfluxadvancedv2": "conditioning",
    "torchcompilevae": "conditioning",
    "torchcompilecontrolnet": "conditioning",
    "torchcompilemodelwanvideov2": "conditioning",
    "torchcompilemodeladvanced": "conditioning",
    "torchcompileltxmodel": "conditioning",
    "torchcompilecosmosmodel": "conditioning",
    "torchcompilemodelhyvideo": "conditioning",
    "torchcompilemodelqwenimage": "conditioning",
    "torchcompilemodelwanvideo": "conditioning",
    // Decoders
    "vaedecodeloopkj": "decoders",
    // Outputs / preview / debug
    "saveimagewithalpha": "outputs",
    "saveimagekj": "outputs",
    "savestringkj": "outputs",
    "modelsavekj": "outputs",
    "dummyout": "outputs",
    "fastpreview": "outputs",
    "previewanimation": "outputs",
    "previewlatentnoisemask": "outputs",
    "imageandmaskpreview": "outputs",
    "visualizesigmaskj": "outputs",
    "camerapose­visualizer": "outputs",
    "cameraposevisualizer": "outputs",
    "bboxvisualize": "outputs",
    "vram_debug": "outputs",
    "timernodekj": "outputs",
    "startrecordcudamemoryhistory": "outputs",
    "endrecordcudamemoryhistory": "outputs",
    "visualizecudamemoryhistory": "outputs",
    // Image input
    "loadandresizeimage": "image-input",
    "loadimagesfromfolderkj": "image-input",
    "loadvideosfromfolder": "image-input",
    "imagegrabpil": "image-input",
    "screencap_mss": "image-input",
    "webcamcapturecv2": "image-input",
    "emptylatentimagepresets": "image-input",
    "emptylatentimagecustompresets": "image-input",
    "imagepass": "image-input",
    "modelpassthrough": "image-input",
    "boolconstant": "image-input",
    "intconstant": "image-input",
    "floatconstant": "image-input",
    // Prompts (string / text / prompt-side utilities)
    "stringconstant": "prompts",
    "stringconstantmultiline": "prompts",
    "stringtofloatlist": "prompts",
    "appendstringstolist": "prompts",
    "joinstrings": "prompts",
    "joinstringmulti": "prompts",
    "widgettostring": "prompts",
    "somethingtostring": "prompts",
    "scalebatchpromptschedule": "prompts",
    "superprompt": "prompts",
    // Post — image / mask / batch / curve / coord / audio
    "addlabel": "post",
    "colormatch": "post",
    "imagetensorlist": "post",
    "crossfadeimages": "post",
    "crossfadeimagesmulti": "post",
    "getimagesfrombatchindexed": "post",
    "getimagerangefrombatch": "post",
    "getlatentrangefrombatch": "post",
    "getlatentsizeandcount": "post",
    "getimagesizeandcount": "post",
    "imagebatchfilter": "post",
    "imageaddmulti": "post",
    "imagebatchjoinwithtransition": "post",
    "imagebatchmulti": "post",
    "imagebatchrepeatinterleaving": "post",
    "imagebatchtestpattern": "post",
    "imageconcanate": "post",
    "imageconcatfrombatch": "post",
    "imageconcatmulti": "post",
    "imagecropbymask": "post",
    "imagecropbymaskandresize": "post",
    "imagecropbymaskbatch": "post",
    "imageuncropbymask": "post",
    "imagebatchextendwithoverlap": "post",
    "imagegridcomposite2x2": "post",
    "imagegridcomposite3x3": "post",
    "imagegridtobatch": "post",
    "imagenoiseaugmentation": "post",
    "imagenormalize_neg1_to_1": "post",
    "imagepadkj": "post",
    "imagepadforoutpaintmasked": "post",
    "imagepadforoutpainttargetsize": "post",
    "imageprepforiclora": "post",
    "imageresizekj": "post",
    "imageresizekjv2": "post",
    "imageupscalewithmodelbatched": "post",
    "insertimagestobatchindexed": "post",
    "insertlatenttoindexed": "post",
    "mergeimagechannels": "post",
    "padimagebatchinterleaved": "post",
    "remapimagerange": "post",
    "reverseimagebatch": "post",
    "replaceimagesinbatch": "post",
    "shuffleimagebatch": "post",
    "splitimagechannels": "post",
    "transitionimagesmulti": "post",
    "transitionimagesinbatch": "post",
    "batchcropfrommask": "post",
    "batchcropfrommaskadvanced": "post",
    "filterzeromasksandcorrespondingimages": "post",
    "insertimagebatchbyindexes": "post",
    "batchuncrop": "post",
    "batchuncropadvanced": "post",
    "splitbboxes": "post",
    "bboxtoint": "post",
    "drawmaskonimage": "post",
    "batchclipseg": "post",
    "blockifymask": "post",
    "colortomask": "post",
    "creategradientmask": "post",
    "createtextmask": "post",
    "createaudiomask": "post",
    "createfademask": "post",
    "createfademaskadvanced": "post",
    "createfluidmask": "post",
    "createshapemask": "post",
    "createvoronoimask": "post",
    "createmagicmask": "post",
    "getmasksizeandcount": "post",
    "growmaskwithblur": "post",
    "maskbatchmulti": "post",
    "offsetmask": "post",
    "remapmaskrange": "post",
    "resizemask": "post",
    "roundmask": "post",
    "separatemasks": "post",
    "consolidatemaskskj": "post",
    "splineeditor": "post",
    "createshapeimageonpath": "post",
    "createshapemaskonpath": "post",
    "createtextonpath": "post",
    "creategradientfromcoords": "post",
    "cutanddragonpath": "post",
    "gradienttofloat": "post",
    "weightscheduleextend": "post",
    "maskorimagetoweight": "post",
    "weightscheduleconvert": "post",
    "floattomask": "post",
    "plotcoordinates": "post",
    "interpolatecoords": "post",
    "pointseditor": "post",
    "soundreactive": "post",
    "normalizedamplitudetomask": "post",
    "normalizedamplitudetofloatlist": "post",
    "offsetmaskbynormalizedamplitude": "post",
    "imagetransformbynormalizedamplitude": "post",
    "audioconcatenate": "post",
    "gettrackrange": "post",
    "addnoisetotrackpath": "post",
    "lazyswitchkj": "post",
    "simplecalculatorkj": "post",
    "sleep": "post",
    "loraextractkj": "outputs",
    "lorareducerankkj": "outputs",

    // --- LTX-Video pack family ---
    // Lightricks/ComfyUI-LTXVideo + logtd/ComfyUI-LTXTricks (deprecated,
    // names overlap) + kijai/ComfyUI-KJNodes (LTXV-specific subset).
    // Loaders
    "ltxvgemmaclipmodelloader": "loaders",
    "ltxvpromptenhancerloader": "loaders",
    "ltxvq8loramodelloader": "loaders",
    "ltx2loraloaderadvanced": "loaders",
    "lowvramcheckpointloader": "loaders",
    "lowvramaudiovaeloader": "loaders",
    "lowvramlatentupscalemodelloader": "loaders",
    // Samplers
    "ltxvbasesampler": "samplers",
    "ltxvextendsampler": "samplers",
    "ltxvincontextsampler": "samplers",
    "ltxvloopingsampler": "samplers",
    "ltxvtiledsampler": "samplers",
    "ltxflowedittcfgguider": "samplers",
    "ltxfloweditcfgguider": "samplers",
    "ltxflowedittsampler": "samplers",
    "ltxfloweditsampler": "samplers",
    "ltxrfforwardodesampler": "samplers",
    "ltxrfreverseodesampler": "samplers",
    "ltxforwardmodelsamplingpred": "samplers",
    "ltxreversemodelsamplingpred": "samplers",
    "ltx2samplingpreviewoverride": "samplers",
    "ltx2audiolatentnormalizingsampling": "samplers",
    "ltxq8patch": "samplers",
    "ltxvlatentupsampler": "samplers",
    // Decoders
    "ltxvtiledvaedecode": "decoders",
    // Conditioning + model patches + guides + attention overrides
    "addlatentguide": "conditioning",
    "ltxvaddlatentguide": "conditioning",
    "ltxvaddguideadvanced": "conditioning",
    "ltxvaddguidemulti": "conditioning",
    "ltxvaddguidesfrombatch": "conditioning",
    "ltxvadainlatent": "conditioning",
    "ltxvapplystg": "conditioning",
    "ltxvstatnormlatent": "conditioning",
    "ltxvperstepadainpatcher": "conditioning",
    "ltxvperstepstatnormpatcher": "conditioning",
    "ltxvpatchervae": "conditioning",
    "ltxvlinearoverlaplatenttransition": "conditioning",
    "ltxvmultipromptprovider": "conditioning",
    "ltxvpromptenhancer": "conditioning",
    "ltxvpreprocessmasks": "conditioning",
    "ltxvsetvideolatentnoisemasks": "conditioning",
    "ltxvimgtovideoconditiononly": "conditioning",
    "ltxvimgtovideoinplacekj": "conditioning",
    "modifyltxmodel": "conditioning",
    "guiderparameters": "conditioning",
    "multimodalguider": "conditioning",
    "stgguidernode": "conditioning",
    "stgguideradvanced": "conditioning",
    "stgadvancedpresets": "conditioning",
    "dynamicconditioning": "conditioning",
    "ltxattentionbank": "conditioning",
    "ltxprepareattninjections": "conditioning",
    "ltxattentiooverride": "conditioning",
    "ltxattnoverride": "conditioning",
    "ltxperturbedattention": "conditioning",
    "ltxfetaenhance": "conditioning",
    "ltx2_nag": "conditioning",
    "ltxvchunkfeedforward": "conditioning",
    "ltx2attentiontunerpatch": "conditioning",
    "ltx2memoryefficientsageattentionpatch": "conditioning",
    "ltxvaudiovideomask": "conditioning",
    "set vae decoder noise": "conditioning",
    // Post-processing
    "ltxvselectlatents": "post",
    "imagetocpu": "post",
    // Prompt enhancement
    "ltxvgemmaenhanceprompt": "prompts",

    "automatic cfg": "conditioning",
    "automatic cfg - advanced": "conditioning",
    "automatic cfg - attention modifiers": "conditioning",
    "automatic cfg - attention modifiers tester": "conditioning",
    "automatic cfg - custom attentions": "conditioning",
    "automatic cfg - excellent attention": "conditioning",
    "automatic cfg - negative": "conditioning",
    "automatic cfg - post rescale only": "conditioning",
    "automatic cfg - preset loader": "conditioning",
    "automatic cfg - unpatch function": "conditioning",
    "automatic cfg - warp drive": "conditioning",
    "sag delayed activation": "conditioning",
    "temperature separate settings clip sdxl": "conditioning",
    "temperature settings clip": "conditioning",
    "temperature settings sdxl": "conditioning",
    "zero uncond cfg - standalone patch (incompatible with the others)": "conditioning",
};

// Fallback classifier: regex on (lowercased) class name + node category.
// Lookup priority (highest wins):
//   1. node._tidy_role          — per-node override the user picked in the
//                                  modal during this session
//   2. USER_OVERRIDES[className] — per-class override the user has saved to
//                                  disk via the editor's Save button
//   3. CLASS_OVERRIDES[className]— built-in table covering stock + popular
//                                  custom packs
//   4. node CATEGORY string     — set by many ComfyUI nodes
//   5. class-name regex         — generic fallback
function classifyNode(node) {
    if (node._tidy_role && ROLES.includes(node._tidy_role)) {
        return node._tidy_role;
    }
    const rawCls = node.type || node.comfyClass || "";
    if (USER_OVERRIDES[rawCls] && ROLES.includes(USER_OVERRIDES[rawCls])) {
        return USER_OVERRIDES[rawCls];
    }
    const cls = rawCls.toLowerCase();

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
    // RES4LYF — every "Sigmas *" node belongs in the sampling column.
    if (/^sigmas\b/.test(cls) || /^sigmas\s/.test(cls) || cls.startsWith("sigmas2 ")) return "samplers";
    if (/sampler|scheduler|guider|noise/.test(cls)) return "samplers";
    if (/loader$|^load[A-Z]/.test(cls)) return "loaders";
    if (/conditioning|guidance|controlnet|reference/.test(cls)) return "conditioning";
    // RES4LYF — Frame / Frames nodes manipulate frame batches; treat as post.
    if (/^frames?\s/.test(cls)) return "post";
    if (/upscale|blur|sharpen|resize|scale|crop|blend/.test(cls)) return "post";
    if (/^empty|^load/.test(cls)) return "image-input";

    return "misc";
}

// =====================================================================
// Layout
// =====================================================================

const COL_GAP = 60;          // px between columns when no groups are drawn
const ROW_GAP = 28;          // px between rows in a column
const TITLE_PAD = 30;        // extra space for node title bar
const ORIGIN_PAD = 50;       // top/left margin from existing graph origin

// Group rendering constants — shared between layout (so it can reserve
// enough between-bucket space for a group card) and createRoleGroups (so
// the group geometry actually matches what layout reserved).
const GROUP_FONT_SIZE = 24;
const GROUP_PAD = 24;        // padding between node and group border
// LiteGraph's group title is drawn at the top of the group bounds and
// occupies roughly `font_size + descender + top/bottom padding` ≈
// `font_size * 1.6` of vertical space. Empirically the user saw ~7-8 px
// of overlap with `36`, so we reserve `font_size * 2 + 4` (= 52 for
// font_size 24) which leaves a comfortable visible gap between the title
// bar and the topmost node.
const GROUP_TITLE_BAR = GROUP_FONT_SIZE * 2 + 4;

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

// Unpack every "container" node — both modern subgraphs (post-0.3.51) AND
// legacy group nodes — into the main graph. Two different APIs to call:
//
//   - Modern subgraph: `graph.unpackSubgraph(node)` — added in
//     Comfy-Org/ComfyUI_frontend#4840. The method lives on the parent
//     LGraph instance, takes the subgraph node, and inlines its inner
//     nodes back into the parent. Same code path the right-click "Unpack
//     subgraph" menu item uses.
//   - Legacy group node: `node.convertToNodes()` — instance method on the
//     group node itself. Same code path as right-click "Convert to nodes" /
//     Alt+Shift+G.
//
// We try subgraph first (cheap, succeeds only on a SubgraphNode), then fall
// back to legacy convertToNodes(). Iterates passes so nested containers get
// fully flattened: unpacking a parent reveals its children, and the next
// pass catches them. Bails after a safety ceiling so a buggy node can't
// infinite-loop.
function unpackAllGroups() {
    const graph = app.graph;
    if (!graph || !graph._nodes) return 0;

    // Duck-type check for modern SubgraphNode — these expose a `.subgraph`
    // (the inner LGraph) and a `getInnerNodes()` method, neither of which
    // exists on legacy nodes or group nodes.
    const isSubgraphNode = (n) => !!(n && (n.subgraph != null || typeof n.getInnerNodes === "function"));

    let totalUnpacked = 0;
    for (let pass = 0; pass < 16; pass++) {
        const nodes = graph._nodes.slice(); // snapshot — unpacking mutates
        let unpackedThisPass = 0;
        for (const node of nodes) {
            // Try modern subgraph first.
            if (isSubgraphNode(node) && typeof graph.unpackSubgraph === "function") {
                try {
                    graph.unpackSubgraph(node);
                    totalUnpacked++;
                    unpackedThisPass++;
                    continue;
                } catch (e) {
                    console.warn("[cleanfreak] unpackSubgraph failed on", node?.type, e);
                }
            }
            // Fall back to legacy group node.
            if (typeof node.convertToNodes === "function") {
                try {
                    node.convertToNodes();
                    totalUnpacked++;
                    unpackedThisPass++;
                } catch (e) {
                    console.warn("[cleanfreak] convertToNodes() failed on", node?.type, e);
                }
            }
        }
        if (unpackedThisPass === 0) break;
    }
    if (totalUnpacked > 0) graph.setDirtyCanvas(true, true);
    return totalUnpacked;
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

    const PAD = GROUP_PAD;
    const TITLE_BAR = GROUP_TITLE_BAR;

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
        // the wide title bar, so bump it to something readable. Pinned to
        // GROUP_FONT_SIZE so the layout's title-bar reservation stays in
        // sync with the actually-rendered title size.
        group.font_size = GROUP_FONT_SIZE;
        graph.add(group);
    }
}

function tidyByRole(orientation = "horizontal", opts = {}) {
    const { groups: addGroups = false, unpack: unpackGroups = false } = opts;
    const graph = app.graph;
    if (!graph || !graph._nodes || !graph._nodes.length) return;

    // Optionally flatten every group node (and any nested ones) into the
    // main graph BEFORE classifying — so what's tidied is a clean flat list
    // of real nodes, not a single group-node placeholder.
    if (unpackGroups) unpackAllGroups();

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
        layoutVertical(buckets, usedRoles, originX, originY, addGroups);
    } else {
        layoutHorizontal(buckets, usedRoles, originX, originY, addGroups);
    }

    if (addGroups) createRoleGroups(buckets, usedRoles);

    app.graph.setDirtyCanvas(true, true);
}

function nodeWidth(n)  { return (n.size && n.size[0]) || 200; }
function nodeHeight(n) { return (n.size && n.size[1]) || 100; }

function layoutHorizontal(buckets, usedRoles, originX, originY, withGroups) {
    // Each role is a column. Width = max node width in column. Nodes stack
    // vertically within the column, top-aligned at originY.
    //
    // When groups are drawn, neighbouring columns each need GROUP_PAD of
    // breathing room on their facing edge — otherwise group cards collide.
    // The plain COL_GAP is already a touch wider than 2 * GROUP_PAD, so
    // headroom here is comfortable, but we widen explicitly when groups are
    // on for visual consistency with the vertical case.
    const interColGap = withGroups
        ? Math.max(COL_GAP, GROUP_PAD * 2 + 16)
        : COL_GAP;

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
        x += colWidth + interColGap;
    }
}

function layoutVertical(buckets, usedRoles, originX, originY, withGroups) {
    // Each role is a row. Height = max node height in row. Nodes stack
    // horizontally within the row, left-aligned at originX.
    //
    // When groups are drawn, the next row's group title bar extends
    // GROUP_PAD + GROUP_TITLE_BAR pixels ABOVE its first node, and the
    // previous row's group bottom extends GROUP_PAD pixels BELOW its last
    // node. So the gap between rows must clear:
    //     prev_group_bottom_pad + next_group_title_top_pad
    //   = GROUP_PAD + (GROUP_PAD + GROUP_TITLE_BAR)
    // …plus a few px of breathing room. Without this, the next row's group
    // title bar overlaps the previous row's group bottom — which is the
    // visual bug the user spotted.
    const interRowGap = withGroups
        ? GROUP_PAD * 2 + GROUP_TITLE_BAR + 16
        : ROW_GAP + TITLE_PAD;

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
        y += rowHeight + interRowGap;
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
    resetBtn.textContent = "Reset session edits";
    resetBtn.title = "Clear every per-node role override from this session and re-classify from scratch";
    resetBtn.style.cssText = "background: #5a4444; color: #ddd; border: none; padding: 7px 14px; border-radius: 4px; cursor: pointer;";
    resetBtn.addEventListener("click", () => {
        for (const { n } of rows) delete n._tidy_role;
        close();
        showClassificationEditor();
    });

    const saveBtn = document.createElement("button");
    saveBtn.textContent = "Save assignments";
    saveBtn.title = "Promote every per-node assignment in this list to a per-class default, saved to <ComfyUI>/user/cleanfreak/role_overrides.json. Future workflows that contain the same node classes will use these assignments automatically.";
    saveBtn.style.cssText = "background: #6b8d4a; color: #fff; border: none; padding: 7px 14px; border-radius: 4px; cursor: pointer;";
    saveBtn.addEventListener("click", async () => {
        // Build the new global overrides map by applying every visible row's
        // current role on top of the existing USER_OVERRIDES. We don't drop
        // pre-existing overrides for classes the current workflow doesn't
        // contain — those would be lost otherwise.
        const merged = { ...USER_OVERRIDES };
        for (const { n } of rows) {
            const cls = n.type || n.comfyClass;
            if (!cls) continue;
            // Find the role currently shown in the dropdown for this row.
            // The select has been updated as the user changed it.
            const role = n._tidy_role || classifyNode(n);
            if (role && ROLES.includes(role)) merged[cls] = role;
        }
        const ok = await saveUserOverrides(merged);
        if (ok) {
            // Once saved at the class level, drop the per-node session
            // override so future tidies read straight from USER_OVERRIDES.
            for (const { n } of rows) delete n._tidy_role;
            saveBtn.textContent = "Saved ✓";
            saveBtn.disabled = true;
            setTimeout(() => { saveBtn.textContent = "Save assignments"; saveBtn.disabled = false; }, 1400);
        } else {
            alert("Saving failed — see browser console for details.");
        }
    });

    const clearDiskBtn = document.createElement("button");
    clearDiskBtn.textContent = "Forget saved";
    clearDiskBtn.title = "Wipe the saved role_overrides.json file. Built-in classification rules still apply.";
    clearDiskBtn.style.cssText = "background: #5a4444; color: #ddd; border: none; padding: 7px 14px; border-radius: 4px; cursor: pointer;";
    clearDiskBtn.addEventListener("click", async () => {
        if (!window.confirm("Delete every saved role override? Built-in classification rules will still apply.")) return;
        const ok = await clearUserOverridesOnDisk();
        if (ok) {
            for (const { n } of rows) delete n._tidy_role;
            close();
            showClassificationEditor();
        } else {
            alert("Failed to clear — see browser console for details.");
        }
    });

    // Unpack-groups toggle — when ticked, every Tidy button below first
    // flattens any group nodes (and nested ones) before classifying.
    const unpackWrap = document.createElement("label");
    unpackWrap.style.cssText = "margin-right: auto; display: flex; align-items: center; gap: 6px; color: #ccc; font-size: 12px; cursor: pointer; user-select: none;";
    const unpackChk = document.createElement("input");
    unpackChk.type = "checkbox";
    unpackChk.style.cssText = "margin: 0;";
    const unpackTxt = document.createElement("span");
    unpackTxt.textContent = "Unpack subgraphs / group nodes first";
    unpackTxt.title = "Before tidying, expand every modern subgraph (graph.unpackSubgraph) AND every legacy group node (convertToNodes) into its constituent nodes. Iterates so nested containers fully flatten.";
    unpackWrap.appendChild(unpackChk);
    unpackWrap.appendChild(unpackTxt);

    const tidyHBtn = document.createElement("button");
    tidyHBtn.textContent = "Tidy (horizontal)";
    tidyHBtn.style.cssText = "background: #406688; color: #fff; border: none; padding: 7px 14px; border-radius: 4px; cursor: pointer;";
    tidyHBtn.addEventListener("click", () => { close(); tidyByRole("horizontal", { unpack: unpackChk.checked }); });

    const tidyVBtn = document.createElement("button");
    tidyVBtn.textContent = "Tidy (vertical)";
    tidyVBtn.style.cssText = "background: #406688; color: #fff; border: none; padding: 7px 14px; border-radius: 4px; cursor: pointer;";
    tidyVBtn.addEventListener("click", () => { close(); tidyByRole("vertical", { unpack: unpackChk.checked }); });

    const tidyHGBtn = document.createElement("button");
    tidyHGBtn.textContent = "Tidy + Groups (horizontal)";
    tidyHGBtn.style.cssText = "background: #4a8a4a; color: #fff; border: none; padding: 7px 14px; border-radius: 4px; cursor: pointer; font-weight: bold;";
    tidyHGBtn.addEventListener("click", () => { close(); tidyByRole("horizontal", { groups: true, unpack: unpackChk.checked }); });

    const tidyVGBtn = document.createElement("button");
    tidyVGBtn.textContent = "Tidy + Groups (vertical)";
    tidyVGBtn.style.cssText = "background: #4a8a4a; color: #fff; border: none; padding: 7px 14px; border-radius: 4px; cursor: pointer; font-weight: bold;";
    tidyVGBtn.addEventListener("click", () => { close(); tidyByRole("vertical", { groups: true, unpack: unpackChk.checked }); });

    // Unpack toggle sits at the LEFT of the footer (margin-right: auto pushes
    // the Tidy / Save / Cancel buttons to the right).
    footer.appendChild(unpackWrap);
    footer.appendChild(cancelBtn);
    footer.appendChild(clearDiskBtn);
    footer.appendChild(resetBtn);
    footer.appendChild(saveBtn);
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
    name: "CleanFreak.TidyByRole",
    async setup(app) {
        // Kick the user-overrides fetch immediately so the first tidy /
        // editor call doesn't have to wait on the network round-trip.
        ensureOverridesLoaded();

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
                content: "✨ Tidy by Role — Unpack subgraphs/groups + Tidy + Groups (horizontal)",
                callback: () => tidyByRole("horizontal", { groups: true, unpack: true }),
            });
            options.push({
                content: "✨ Tidy by Role — Unpack subgraphs/groups + Tidy + Groups (vertical)",
                callback: () => tidyByRole("vertical", { groups: true, unpack: true }),
            });
            options.push({
                content: "✨ Tidy by Role — Unpack all subgraphs / group nodes (no tidy)",
                callback: () => {
                    const n = unpackAllGroups();
                    if (typeof window !== "undefined") {
                        alert(`Unpacked ${n} subgraph${n === 1 ? "" : "s"} / group node${n === 1 ? "" : "s"}.`);
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
