"""Checks for the generic illustrated 2.5D scenario route."""
import hashlib
import json
import math
import re
from pathlib import Path

LEGACY_PROFILE = "legacy-reference-unavailable"
PROFILE = "illustrated-2-5d"
PROFILES = {PROFILE}
REFERENCE_ANCHOR = {"id": "illustrated-2-5d-material-board", "path": "assets/style/material-board.svg",
                    "material_family": "illustrated-layered-matte"}
ROLES_PATH = "assets/style/roles.json"
WEATHER_KINDS = {"weather-cloud", "relief", "air-path", "air-mass", "callout", "follow-chip", "droplets", "fog-bank"}
TONES = {"day", "dusk", "dim", "studio"}
IMAGE_FORMATS = {".jpg", ".jpeg", ".png", ".webp", ".svg"}


def validate_layers(program, image_ids, profile, brand_shots):
    def visit(nodes, brand=False):
        for node in nodes:
            kind = node["kind"]
            if kind == "image" and node["asset"] not in image_ids:
                raise ValueError(f"{node['asset']}: use an illustration with role-specific comparison evidence.")
            if kind == "shape" and "fill" in node and not node.get("material"):
                raise ValueError("Filled props need a matte material. Use a stroke for a guide line.")
            if kind == "landscape":
                world = node.get("world", {})
                if world.get("tone", "day") not in TONES:
                    raise ValueError("Choose a defined lighting tone; project sky colors may be overridden.")
                if "colors" in world:
                    stops = world["colors"]
                    valid = (isinstance(stops, list) and len(stops) >= 2
                             and all(isinstance(stop, list) and len(stop) == 2
                                     and type(stop[0]) in (int, float) and math.isfinite(stop[0])
                                     and 0 <= stop[0] <= 1 and isinstance(stop[1], str)
                                     and re.fullmatch(r"#[0-9a-fA-F]{6}", stop[1]) for stop in stops))
                    if valid:
                        valid = all(left[0] <= right[0] for left, right in zip(stops, stops[1:]))
                    if not valid:
                        raise ValueError("landscape.world.colors needs ordered [position, '#RRGGBB'] stops, positions within 0..1.")
            if kind == "relief":
                choices = {"side", "near", "overhead"}
                choices |= {"foothill"} if profile == LEGACY_PROFILE else {"upslope", "downslope"}
                if node.get("plane", "side") not in choices:
                    raise ValueError("Choose a defined terrain plane.")
            if kind == "weather-cloud":
                choices = {"fair", "rain", "thinning"}
                if profile == PROFILE:
                    choices.update(("overhead", "tower"))
                if node.get("variant", "fair") not in choices:
                    raise ValueError("Choose a cloud form for the viewpoint.")
            if kind == "air-path":
                points = node.get("points")
                if not isinstance(points, list) or len(points) != 4 or any(
                    not isinstance(p, list) or len(p) != 2 or any(type(v) not in (int, float) for v in p)
                    for p in points
                ):
                    raise ValueError("Air path requires four fixed cubic control points.")
                if profile == PROFILE and node.get("tone", "lift") not in ("lift", "warm", "cool", "map"):
                    raise ValueError("Choose lift, warm, cool, or map for airflow.")
            if kind == "follow-chip" and node.get("color_only"):
                if profile != PROFILE or node.get("after", node["before"]) != node["before"]:
                    raise ValueError("A color-only button needs the active profile and the same text.")
            if kind == "group":
                visit(node["layers"], brand)

    for key, shot in program["shots"].items():
        visit(shot["layers"], key in brand_shots)
    for layers in program["objects"].values():
        visit(layers)


def check_reference_plan(plan, base, atlas):
    profile = plan["project"].get("style_profile")
    if profile not in PROFILES:
        return
    assets = {asset["id"]: asset for asset in plan["assets"]}
    roles = json.loads((base / ROLES_PATH).read_text())["roles"]
    reviews = plan.get("illustration_reviews", {})
    image_ids = set()
    for key, asset in assets.items():
        if Path(asset["path"]).suffix.lower() not in IMAGE_FORMATS:
            continue
        digest = hashlib.sha256((base / asset["path"]).read_bytes()).hexdigest()
        review = reviews.get(key, {})
        if (review.get("role") not in roles or review.get("art_sha256") != digest
                or not str(review.get("observation", "")).strip()):
            raise ValueError(f"{key}: compare the actual cutout against its reference role first.")
        proof = (base / review["comparison"]).resolve()
        if (not proof.is_relative_to(base.resolve()) or proof.suffix.lower() not in {".jpg", ".jpeg", ".png"}
                or hashlib.sha256(proof.read_bytes()).hexdigest() != review.get("comparison_sha256")):
            raise ValueError(f"{key}: illustration comparison is missing or changed.")
        image_ids.add(key)
    for shot in plan["shots"]:
        renderer = shot["renderer"]
        if renderer.get("module") not in ("scripts/scenario_stage.cjs", "source/runtime/scenario_stage.cjs") or renderer.get("graph") != "scene-graph":
            raise ValueError(f"{shot['id']}: use the shared scene stage.")
    graph = json.loads((base / assets["scene-graph"]["path"]).read_text())
    last = plan["shots"][-1] if plan["shots"] else {}
    brand_shots = {last["id"]} if last.get("view") == "brand" else set()
    validate_layers(graph, image_ids, profile, brand_shots)
