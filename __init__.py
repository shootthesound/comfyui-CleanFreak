"""comfyui-workflow-tidy — one-click workflow layout by node role.

Adds a "Tidy by Role" action to the canvas right-click menu. When triggered,
every node in the graph is classified into a role bucket (loaders, encoders,
conditioning, samplers, decoders, outputs, image-input, prompts, lora-loaders,
misc) and laid out in width-aware columns. Connections are never touched —
ComfyUI's links are by node id, so moving a node never breaks a wire.

This pack is JS-only; no backend nodes are registered. The Python file just
points ComfyUI at the web directory.
"""

WEB_DIRECTORY = "./web"

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
