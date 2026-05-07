"""comfyui-CleanFreak — one-click workflow layout by node role.

Adds a "Tidy by Role" action set to the canvas right-click menu. Every node
in the graph is classified into a role bucket (loaders, encoders,
conditioning, samplers, decoders, outputs, image-input, prompts, post,
misc) and laid out in width-aware columns. Connections are never touched —
ComfyUI's links are by node id, so moving a node never breaks a wire.

Also exposes a small HTTP API for the user-overrides JSON file so the
frontend's classification editor can persist per-class role assignments
across sessions and workflows. The file gradually accumulates the user's
preferred role for every node class they've explicitly re-assigned, so
future tidies start with a richer classifier than the built-in heuristics.

Stored at::

    <ComfyUI>/user/cleanfreak/role_overrides.json
"""

from __future__ import annotations

import json
import os
import threading

import folder_paths

try:
    from server import PromptServer
    _HAS_SERVER = True
except ImportError:
    _HAS_SERVER = False


WEB_DIRECTORY = "./web"

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]


# --- Persistent user overrides --------------------------------------

_LOCK = threading.Lock()


def _overrides_path() -> str:
    base = os.path.join(folder_paths.get_user_directory(), "cleanfreak")
    os.makedirs(base, exist_ok=True)
    return os.path.join(base, "role_overrides.json")


def _load_overrides() -> dict:
    path = _overrides_path()
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}
    if isinstance(data, dict) and isinstance(data.get("overrides"), dict):
        return {str(k): str(v) for k, v in data["overrides"].items()}
    if isinstance(data, dict):
        # Tolerate a flat {"ClassName": "role"} shape too.
        return {str(k): str(v) for k, v in data.items() if isinstance(v, str)}
    return {}


def _save_overrides(overrides: dict) -> None:
    path = _overrides_path()
    payload = {"version": 1, "overrides": overrides}
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, sort_keys=True)
    os.replace(tmp, path)


# --- HTTP API ------------------------------------------------------

if _HAS_SERVER:
    from aiohttp import web

    routes = PromptServer.instance.routes

    @routes.get("/cleanfreak/overrides")
    async def _get_overrides_route(request):
        with _LOCK:
            overrides = _load_overrides()
        return web.json_response({"overrides": overrides})

    @routes.post("/cleanfreak/overrides")
    async def _save_overrides_route(request):
        try:
            data = await request.json()
        except Exception:
            return web.json_response({"error": "invalid JSON"}, status=400)
        incoming = (data or {}).get("overrides")
        if not isinstance(incoming, dict):
            return web.json_response({"error": "overrides must be an object"}, status=400)
        # Whitelist the value type — anything non-string is dropped silently
        # so a malformed frontend can't poison the file.
        cleaned = {str(k): str(v) for k, v in incoming.items() if isinstance(v, str) and v}
        with _LOCK:
            _save_overrides(cleaned)
        return web.json_response({"ok": True, "overrides": cleaned})

    @routes.post("/cleanfreak/overrides/clear")
    async def _clear_overrides_route(request):
        with _LOCK:
            _save_overrides({})
        return web.json_response({"ok": True, "overrides": {}})
