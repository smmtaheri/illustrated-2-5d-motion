#!/usr/bin/env python3
"""Compile an authored shot recipe into a portable illustrated-reel project."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata
import wave
from voice_handoff import write_voice_handoff
from reference_style import (PROFILE, PROFILES, REFERENCE_ANCHOR, ROLES_PATH, WEATHER_KINDS)

ROOT = Path(__file__).resolve().parent.parent
ANCHOR = REFERENCE_ANCHOR
LAYER_KINDS = {
    "warm-air", "shape", "group", "instance", "landscape", "image", "cloud", "glow", "light-disc", "boiling-pan",
    "rays", "parcel", "standing", "wing-pilot", "gauge", "thermometer", "emit", "arrow", "label", "pill", "volume",
} | WEATHER_KINDS
MATTE_TONES = {"slate", "sage", "earth", "amber", "mist", "ink"}
COLOR_NAMES = {"amber", "gold", "coral", "ivory", "ink", "steel", "slate",
               "lightBlue", "blue", "green", "shadow"}
MATERIALS_PATH = "assets/house-materials.json"
# Combining marks from the Arabic-script blocks and legacy tashkeel forms.
ARABIC_MARK_RANGES = (
    range(0x0610, 0x061B), range(0x064B, 0x0660), range(0x0670, 0x0671),
    range(0x06D6, 0x06EE), range(0x0897, 0x08A0), range(0x08CA, 0x0900),
    range(0x10EFD, 0x10F00),
)
PERSIAN_DISPLAY_MARKS = {
    codepoint: None
    for block in ARABIC_MARK_RANGES
    for codepoint in block
    if unicodedata.category(chr(codepoint)).startswith("M")
}
PERSIAN_DISPLAY_MARKS.update(str.maketrans("", "", "\ufe70\ufe71\ufe72\ufe74\ufe76\ufe77\ufe78\ufe79\ufe7a\ufe7b\ufe7c\ufe7d\ufe7e\ufe7f"))
RUNTIME = [
    "compile_scenario.py", "voice_handoff.py", "recipe_parts.py", "reference_style.py", "weather_parts.cjs", "reference_weather.cjs",
    "font_runtime.cjs", "scenario_stage.cjs", "thermal_flow.cjs", "thermal_mechanisms.cjs", "paraglider_rig.cjs", "type_motion.cjs", "scene_runtime.cjs", "motion_kit.cjs", "render_project.cjs",
    "check_project.py", "review_video.py", "audio_timeline.py", "reference_audio_contract.py",
    "assemble_narration.py", "resolve_events.py",
    "audit_mix.py",
]
SOUNDS = {
    name: f"assets/{directory}/{name}.wav"
    for directory, names in [
        ("audio", ["air-bed-loop", "air-sweep", "distant-rain-loop", "soft-resolve", "soft-tick"]),
        ("reconstruction-sound", ["boat", "click", "fabric", "radio", "water-bed", "zipper"]),
    ]
    for name in names
}


def dump(path, obj):
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")


def strip_persian_display_marks(value):
    if isinstance(value, str):
        # Compose letters such as آ and ئ before removing standalone marks.
        return unicodedata.normalize("NFC", value).translate(PERSIAN_DISPLAY_MARKS)
    if isinstance(value, list):
        return [strip_persian_display_marks(item) for item in value]
    if isinstance(value, dict):
        return {key: strip_persian_display_marks(item) for key, item in value.items()}
    return value


def required(condition, detail):
    if not condition:
        raise ValueError(detail)


def identifier(value):
    required(isinstance(value, str) and value and value.isascii()
             and all(c.isalnum() or c in "-_" for c in value), f"Invalid identifier: {value!r}")
    return value


def finite(value):
    return type(value) in (float, int) and math.isfinite(value)


def palette_color(value):
    return isinstance(value, str) and (value in COLOR_NAMES or re.fullmatch(r"#[0-9a-fA-F]{6}", value))


def inspect_finish(layer):
    kind = layer["kind"]
    if "material" in layer:
        material = layer["material"]
        if isinstance(material, str):
            material = {"tone": material}
        required(kind == "shape" and isinstance(material, dict)
                 and material.get("tone", "slate") in MATTE_TONES,
                 "Use a known matte material on a shape.")
        for key, high in {"depth":18, "grain":1, "lip":1, "edgeWidth":4}.items():
            if key in material:
                required(finite(material[key]) and 0 <= material[key] <= high,
                         f"Matte {key} must be between 0 and {high}.")
        if "tint" in material:
            required(palette_color(material["tint"]), "Matte tint needs a palette name or six-digit hex color.")
        if "d" in layer or "bounds" in material:
            box = material.get("bounds")
            required(isinstance(box, list) and len(box) == 4 and all(finite(v) for v in box)
                     and box[2] > 0 and box[3] > 0, "Matte SVG paths require bounds [x, y, w, h].")
        required(material.get("light", "left") in ("left", "right"), "Matte light must be left or right.")
    if kind == "volume":
        points = layer.get("points")
        if isinstance(points, dict):
            points = [row[1] for row in points.get("keys", [])]
        else:
            points = [points]
        required(bool(points) and all(isinstance(path, list) and len(path) >= 2
                 and all(isinstance(p, list) and len(p) == 2 and all(finite(n) for n in p) for p in path)
                 for path in points), "Volume requires a polyline with at least two finite points.")
        required(all(len(path) == len(points[0]) for path in points), "Volume morphs require equal vertex counts.")
        for key in ("tint", "highlight"):
            if key in layer:
                required(palette_color(layer[key]), f"Volume {key} needs a palette name or six-digit hex color.")
    if kind == "fog-bank":
        required(all(finite(layer.get(key)) and layer[key] > 0 for key in ("w", "h")),
                 "A fog bank needs a positive width and height.")
        for key in ("tint", "lit_tint"):
            if key in layer:
                required(isinstance(layer[key], str) and re.fullmatch(r"#[0-9a-fA-F]{6}", layer[key]),
                         f"Fog {key} needs a six-digit hex color.")
    if kind == "landscape":
        required((layer.get("world") or {}).get("plane", "full") in ("full", "sky", "far", "middle", "near"),
                 "Unknown landscape plane.")


def match_entry(shot, fps):
    """Ease one foreground wrapper from its previous screen pose."""
    layers = shot["layers"]
    match = shot.get("match_entry")
    if match is None:
        return layers
    actor = match["actor"]
    initial = match["from"]
    frames = match["frames"]
    required(isinstance(initial, list) and len(initial) == 3 and all(finite(v) for v in initial)
             and initial[2] > 0 and type(frames) is int and 0 < frames < shot["frames"],
             f"{shot['id']}: match_entry needs a valid [x, y, scale] and frame count.")
    candidates = [i for i, layer in enumerate(layers) if layer.get("id") == actor]
    required(len(candidates) == 1, f"{shot['id']}: match a named top-level foreground wrapper.")
    index = candidates[0]
    layer = layers[index]
    pose = [layer.get("x", 0), layer.get("y", 0), layer.get("scale", 1)]
    required(layer["kind"] in ("group", "instance") and all(finite(v) for v in pose)
             and pose[2] > 0 and "sx" not in layer and "sy" not in layer,
             f"{shot['id']}: use a group with a fixed destination pose and animate its children.")
    translated = {**layer, **{
        key: {"keys": [[0, start], [frames/fps, end]], "ease": "smooth"}
        for key, start, end in zip(("x", "y", "scale"), initial, pose)
    }}
    return [*layers[:index], translated, *layers[index+1:]]


def track_state(spec, event_ids):
    if not isinstance(spec, dict) or not ("keys" in spec or "wave" in spec):
        return False
    if "event" in spec:
        required(spec["event"] in event_ids, f"Unknown visual event {spec['event']!r}")
    if "repeat" in spec:
        required(finite(spec["repeat"]) and spec["repeat"] > 0, "Repeat must be positive seconds.")
    if "wave" in spec:
        w = spec["wave"]
        required(isinstance(w, list) and len(w) in (3, 4) and all(finite(x) for x in w) and w[2] > 0,
                 "Wave is [center, amplitude, positive period, optional phase].")
        return w[1] != 0
    keys = spec["keys"]
    required(isinstance(keys, list) and keys and all(isinstance(k, list) and len(k) == 2 and finite(k[0]) for k in keys)
             and all(a[0] < b[0] for a, b in zip(keys, keys[1:])), "Keys require increasing seconds and values.")
    required(spec.get("ease", "linear") in ("linear", "smooth", "step"), "Unknown key easing.")
    return any(k[1] != keys[0][1] for k in keys[1:])


def resolve_layer_tracks(layers, tracks):
    resolved = []
    for layer in layers:
        node = {}
        for key, value in layer.items():
            if key == "layers":
                value = resolve_layer_tracks(value, tracks)
            elif isinstance(value, dict) and "track" in value:
                name = identifier(value["track"])
                required(len(value) == 1 and name in tracks,
                         f"Use a declared shared track without per-view overrides: {name}")
                value = tracks[name]
            node[key] = value
        resolved.append(node)
    return resolved


def uses_wing(layers, objects):
    for node in layers:
        if node["kind"] == "wing-pilot":
            return True
        if node["kind"] == "group" and uses_wing(node["layers"], objects):
            return True
        if node["kind"] == "instance" and uses_wing(objects[node["object"]], objects):
            return True
    return False


def uses_flow(layers, objects):
    for node in layers:
        if node["kind"] in ("arrow", "parcel", "warm-air"):
            return True
        if node["kind"] == "group" and uses_flow(node["layers"], objects):
            return True
        if node["kind"] == "instance" and uses_flow(objects[node["object"]], objects):
            return True
    return False


def uses_mechanism(layers, objects):
    for node in layers:
        if node["kind"] in ("boiling-pan", "gauge", "thermometer") or (node["kind"] == "emit" and node.get("mode") == "bubbles"):
            return True
        if node["kind"] == "group" and uses_mechanism(node["layers"], objects):
            return True
        if node["kind"] == "instance" and uses_mechanism(objects[node["object"]], objects):
            return True
    return False


def uses_weather(layers, objects):
    for node in layers:
        if node["kind"] in WEATHER_KINDS:
            return True
        if node["kind"] in ("group", "instance"):
            children = node["layers"] if node["kind"] == "group" else objects[node["object"]]
            if uses_weather(children, objects):
                return True
    return False


def inspect_layers(layers, objects, image_ids, events, ancestry=(), profile=None):
    required(isinstance(layers, list) and layers, "A scene and each group need visible layer definitions.")
    images, actors = set(), {}
    uses_type, animated = False, False
    for layer in layers:
        kind = layer["kind"]
        required(kind in LAYER_KINDS, f"Unknown layer kind: {kind}")
        if kind in ("droplets", "fog-bank") or (kind == "follow-chip" and layer.get("color_only")):
            required(profile == PROFILE, f"{kind} requires the illustrated-2-5d profile.")
        tracks = [track_state(v, events) for v in layer.values()]
        inspect_finish(layer)
        local_motion = kind not in ("label", "pill") and any(tracks)
        moved = local_motion or (kind == "warm-air" and layer.get("count", 13) > 0) or (kind == "emit" and layer.get("count", 16) > 0) or (kind == "boiling-pan" and not layer.get("frozen", False))
        if kind == "image":
            asset = layer["asset"]
            required(asset in image_ids, f"Undeclared image: {asset}")
            images.add(asset)
        uses_type |= kind in ("label", "pill", "callout", "air-path", "air-mass", "follow-chip") or (kind in ("gauge", "thermometer") and bool(layer.get("labels") or layer.get("label")))
        if kind in ("group", "instance"):
            if kind == "instance":
                key = layer["object"]
                required(key in objects and key not in ancestry, f"Missing or recursive object: {key}")
                children, trail = objects[key], ancestry + (key,)
            else:
                children, trail = layer["layers"], ancestry
            subimages, subactors, typed, submotion = inspect_layers(children, objects, image_ids, events, trail, profile)
            images |= subimages
            uses_type |= typed
            moved |= submotion
            if kind == "group":
                required(not (actors.keys() & subactors.keys()), "Layer IDs must be unique within a shot.")
                actors.update({key: state or local_motion for key, state in subactors.items()})
        if "id" in layer:
            key = identifier(layer["id"])
            required(key not in actors, f"Duplicate actor {key}")
            actors[key] = moved
        animated |= moved
    return images, actors, uses_type, animated


def language_settings(recipe):
    keys = ("overall", "narration", "dialogue", "screen_text", "subtitles")
    supplied = recipe.get("language", {})
    inputs = {key: supplied.get(key) for key in keys}
    inputs["subtitles_requested"] = supplied.get("subtitles_requested", False)
    overall = inputs["overall"]
    resolved = {key: inputs[key] or overall or "en" for key in keys[1:4]}
    resolved["subtitles"] = inputs["subtitles"]
    if resolved["subtitles"] is None and inputs["subtitles_requested"]:
        resolved["subtitles"] = overall or resolved["narration"]
    return {"input": inputs, "resolved": resolved}


def frame_count(value, label):
    required(type(value) is int and value > 0, f"{label} must be a positive integer frame count.")
    return value


def copy_builtin(out, path):
    destination = out / path
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(ROOT / path, destination)


def check_required_elements(shot, objects, actors):
    """Bind essential actions to real named layers."""
    def walk(layers):
        for node in layers:
            yield node
            if node["kind"] == "group":
                yield from walk(node["layers"])
            if node["kind"] == "instance":
                yield from walk(objects[node["object"]])

    for item in shot.get("required_elements", []):
        key, kind = item["id"], item["kind"]
        required(any(node.get("id") == key and node["kind"] == kind for node in walk(shot["layers"])),
                 f"{shot['id']}: required visible {kind} {key!r} is missing.")
        if item.get("animated"):
            required(actors.get(key), f"{shot['id']}: {key!r} must change independently.")


def compile_recipe(recipe, source, out):
    fps = frame_count(recipe.get("fps", 30), "fps")
    width = frame_count(recipe.get("width", 1080), "width")
    required(width % 18 == 0, "Width must be divisible by 18 for even 9:16 output.")
    settings = language_settings(recipe)
    profile = recipe.get("style_profile", PROFILE)
    required(profile is None or profile in PROFILES, "Use illustrated-2-5d or omit style_profile; historical branded profiles are not bundled.")
    anchor = dict(REFERENCE_ANCHOR)
    custom_anchor = recipe.get("style_anchor")
    anchor_source = None
    if custom_anchor is not None:
        required(isinstance(custom_anchor, dict), "style_anchor must be an object.")
        anchor_source = (source / custom_anchor["path"]).resolve()
        required(anchor_source.is_file() and anchor_source.suffix.lower() in (".svg", ".png", ".jpg", ".jpeg", ".webp"),
                 "Supply your own readable style-anchor image.")
        required(isinstance(custom_anchor.get("material_family"), str) and custom_anchor["material_family"].strip(),
                 "style_anchor.material_family is required.")
        anchor = {"id": identifier(custom_anchor.get("id", "custom-style")),
                  "path": "assets/style-anchor" + anchor_source.suffix.lower(),
                  "material_family": custom_anchor["material_family"]}
    requested_audio = recipe.get("audio", {})
    mode = requested_audio.get("mode", "narrated")
    human_voice = requested_audio.get("voice_delivery") == "user"
    if human_voice:
        required(mode != "silent", "User voice handoff needs a sound_only or narrated picture plan.")
        mode = "sound_only"
    heading_transition = recipe.get("heading_transition", "stagger")
    required(heading_transition in ("stagger", "blend"), "Unknown heading transition.")
    required(mode in ("narrated", "silent", "sound_only"), f"Unknown audio mode: {mode}")
    objects = recipe.get("objects", {})
    raw_shots = recipe["shots"]
    required(isinstance(raw_shots, list) and raw_shots, "Declare at least one shot.")
    assets, imported, art_reviews = {}, {}, {}
    for asset in recipe.get("assets", []):
        key = identifier(asset["id"])
        required(key not in imported, f"Duplicate asset: {key}")
        required(key not in {"narration","scene-graph","scenario-stage","house-materials","type-regular","type-bold","thermal-flow","flow-style","thermal-mechanisms","mechanism-style","paraglider-rig","type-motion","type-style","weather-parts","reference-weather"},
                 f"Reserved asset ID: {key}")
        file = (source / asset["path"]).resolve()
        kind = asset.get("kind", "illustration")
        required(file.is_file(), f"Missing imported asset: {asset['path']}")
        required(kind in ("illustration", "diagram", "audio"), f"Unknown imported kind: {kind}")
        allowed = {".png", ".jpg", ".jpeg", ".webp", ".svg"} if kind != "audio" else {".wav"}
        required(file.suffix.lower() in allowed, f"Unsupported file type for {key}")
        imported[key] = (file, kind)
        if profile == PROFILE and kind != "audio":
            review = asset.get("reference_review", {})
            proof = (source / review.get("comparison", "")).resolve()
            required(proof.is_file() and proof.suffix.lower() in (".png", ".jpg", ".jpeg")
                     and review.get("role") and isinstance(review.get("observation"), str)
                     and review["observation"].strip(), f"{key}: supply a role and actual side-by-side illustration review.")
            art_reviews[key] = (review, proof)
    image_ids = {key for key, (_, kind) in imported.items() if kind != "audio"}

    clocks, event_frames = {}, {}
    frame = 0
    for shot in raw_shots:
        shot_id = identifier(shot["id"])
        required(shot_id not in clocks, f"Duplicate shot: {shot_id}")
        count = frame_count(shot["frames"], f"{shot_id}.frames")
        clocks[shot_id] = (frame, frame+count)
        for key, local in shot.get("events", {}).items():
            identifier(key)
            required(type(local) is int and 0 <= local < count and key not in event_frames,
                     f"Duplicate or out-of-shot event {key!r}")
            event_frames[key] = frame+local
        frame += count
    total = frame
    events = [{"id":key,"time":at/fps} for key, at in sorted(event_frames.items(), key=lambda pair: pair[1])]
    shared_tracks = recipe.get("shared_tracks", {})
    required(isinstance(shared_tracks, dict), "Shared tracks must be named in a mapping.")
    for key, track in shared_tracks.items():
        identifier(key)
        required(isinstance(track, dict) and track.get("event") in event_frames and track_state(track, event_frames),
                 f"Shared track {key} needs a changing value on a declared event clock.")
    objects = {key: resolve_layer_tracks(layers, shared_tracks) for key, layers in objects.items()}
    script, beats, shots, cues, graph = [], [], [], [], {}
    audio_paths = {}
    use_text = False

    def use_asset(key):
        if key not in assets:
            original, kind = imported[key]
            local = Path("assets/imported") / (key + original.suffix.lower())
            (out / local).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(original, out / local)
            assets[key] = {"id":key,"path":local.as_posix(),"kind":kind}
            if kind == "illustration":
                assets[key].update(material_family=anchor["material_family"],
                                   style_lineage={"anchor_id":anchor["id"],"source_asset_ids":[]})
        return key

    def sound(name):
        if name in audio_paths:
            return audio_paths[name]
        if name in SOUNDS:
            key = "sound-" + name
            required(key not in imported, f"Imported ID conflicts with bundled sound: {key}")
            file = SOUNDS[name]
            copy_builtin(out, file)
            assets[key] = {"id":key,"path":file,"kind":"audio"}
        else:
            required(name in imported and imported[name][1] == "audio", f"Unknown sound: {name}")
            key = use_asset(name)
        with wave.open(str(out / assets[key]["path"])) as reader:
            seconds = reader.getnframes()/reader.getframerate()
        audio_paths[name] = (key, seconds)
        return audio_paths[name]

    for index, shot in enumerate(raw_shots):
        required("hawatch_outro" not in shot and "brand_outro" not in shot,
                 "Compose your own brand/outro layers; no branded macro or logo is bundled.")
        shot = {**shot, "layers": resolve_layer_tracks(shot["layers"], shared_tracks)}
        shot_id = shot["id"]
        first, last = clocks[shot_id]
        images, actors, typed, _ = inspect_layers(shot["layers"], objects, image_ids, event_frames, profile=profile)
        check_required_elements(shot, objects, actors)
        uses_paraglider = uses_wing(shot["layers"], objects)
        uses_thermal_mechanism = uses_mechanism(shot["layers"], objects)
        uses_thermal_flow = uses_flow(shot["layers"], objects)
        action = shot["action"]
        required(actors.get(action["actor"]), f"{shot_id}: primary actor has no independent animated state.")
        active = action.get("active_frames", [0,last-first])
        required(len(active) == 2 and all(type(x) is int for x in active)
                 and 0 <= active[0] < active[1] <= last-first, f"{shot_id}: invalid active action interval.")
        if "title" in shot:
            required(shot["title"].get("lines") or shot["title"].get("support"), f"{shot_id}: empty title.")
        use_text |= typed or bool(shot.get("title"))
        graph[shot_id] = {k:shot[k] for k in ("title","grain") if k in shot}
        if "title" in graph[shot_id]:
            graph[shot_id]["title"].setdefault("motion_profile", "illustrated-pop")
        graph[shot_id]["layers"] = match_entry(shot, fps)
        beat_id = identifier(shot.get("beat", shot_id))
        if not beats or beats[-1]["id"] != beat_id:
            required(not any(x["id"] == beat_id for x in beats), f"Discontinuous beat: {beat_id}")
            voice = recipe.get("beats", {}).get(beat_id, {}).get("voice", shot.get("voice"))
            if mode == "narrated" or human_voice:
                required(isinstance(voice, str) and voice.strip(), f"Missing spoken text for {beat_id}.")
                script.append({"id":beat_id,"text":voice})
            beats.append({"id":beat_id,"start":first/fps,"end":last/fps,
                          "meaning":recipe.get("beats", {}).get(beat_id, {}).get("meaning", shot["information"])})
            if mode == "narrated" or human_voice:
                beats[-1].update(narration=voice, narration_language=settings["resolved"]["narration"])
        else:
            beats[-1]["end"] = last/fps
        renderer = {"type":"module","module":"scripts/scenario_stage.cjs","graph":"scene-graph","auto_heading":False}
        renderer.update(heading_transition=heading_transition, heading_space="screen")
        if "camera" in shot:
            renderer["camera"] = shot["camera"]
        entry = {
            "id":shot_id,"start":first/fps,"end":last/fps,"beat_id":beat_id,
            "view":shot["view"],"layout_id":shot["layout"],
            "focal_subject":"scene-graph","new_information":shot["information"],
            "primary_action":{"subject":"scene-graph","actor":action["actor"],"channel":action["channel"],
                              "description":action["description"],"active_start":(first+active[0])/fps,
                              "active_end":(first+active[1])/fps},
            "asset_ids":["scene-graph","scenario-stage",*[use_asset(key) for key in sorted(images)]],
            "transition":shot.get("transition","cut"),"renderer":renderer,
        }
        if shot.get("title", {}).get("motion_profile", "illustrated-pop") != "legacy" and "title" in shot:
            entry["asset_ids"] += ["type-motion", "type-style"]
        if uses_thermal_flow:
            entry["asset_ids"] += ["thermal-flow", "flow-style"]
        if uses_thermal_mechanism:
            entry["asset_ids"] += ["thermal-mechanisms", "mechanism-style"]
        if uses_paraglider:
            entry["asset_ids"].append("paraglider-rig")
        if uses_weather(shot["layers"], objects):
            entry["asset_ids"].append("weather-parts")
            if profile == PROFILE:
                entry["asset_ids"].append("reference-weather")
        for key in ("intentional_reprise_of","reprise_reason"):
            if key in shot:
                entry[key] = shot[key]
        shots.append(entry)
        for index, cue in enumerate(shot.get("cues", [])):
            required(mode != "silent", "A requested silent reel cannot have sound cues.")
            key, seconds = sound(cue["sound"])
            event = cue.get("event")
            at = event_frames[event] if event is not None else first+cue["frame"]
            required(type(at) is int and first <= at < last, f"Out-of-shot audio cue in {shot_id}")
            length = min(cue.get("frames", math.ceil(seconds*fps)),last-at)/fps
            item = {"id":f"{shot_id}-cue-{index+1}","kind":"sfx","shot_id":shot_id,"asset_id":key,
                    "start":at/fps,"end":at/fps+length,"gain_db":cue.get("gain_db",-9),
                    "stereo_pan":cue.get("stereo_pan",0),"semantic_event":cue.get("meaning",shot["information"])}
            if event is not None:
                item.update(event_id=event, duration_seconds=length)
            if cue.get("foreground", False):
                required(event is not None, "A foreground sound must share a declared visual event.")
                item["foreground"] = True
            cues.append(item)

    for beat in beats:
        window = recipe.get("beats", {}).get(beat["id"], {}).get("speech_window_frames")
        if window is not None:
            span = round((beat["end"] - beat["start"]) * fps)
            required((mode == "narrated" or human_voice) and isinstance(window, list) and len(window) == 2
                     and all(type(v) is int for v in window) and 0 <= window[0] < window[1] <= span,
                     f"{beat['id']}: speech window must fit inside the narrated beat.")
            if mode == "narrated" or human_voice:
                beat["narration_window"] = [beat["start"] + value/fps for value in window]
    for file in RUNTIME:
        copy_builtin(out, "scripts/"+file)
    if anchor_source is not None:
        anchor_target = out / anchor["path"]
        anchor_target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(anchor_source, anchor_target)
    else:
        copy_builtin(out, anchor["path"])
    if profile == PROFILE:
        copy_builtin(out, ROLES_PATH)
    copy_builtin(out, MATERIALS_PATH)
    copy_builtin(out,"assets/font-manifest.json")
    for font_file in (ROOT/"assets/fonts").iterdir():
        if font_file.suffix==".ttf" or font_file.name.startswith("LICENSE-"):
            copy_builtin(out,str(font_file.relative_to(ROOT)))
    materials = json.loads((ROOT / MATERIALS_PATH).read_text())
    custom_type = recipe.get("typography")
    if custom_type:
        required(isinstance(custom_type, dict), "typography must name explicit bundled regular/bold files.")
        font_manifest = json.loads((out/"assets/font-manifest.json").read_text())
        screen_script = settings["resolved"]["screen_text"].split("-")[0].casefold()
        rtl = screen_script in ("fa","ar","ur")
        type_profile = materials["type"]["rtl" if rtl else "en"]
        for role in ("regular","bold"):
            filename = custom_type[role]
            required(filename in font_manifest["files"] and Path(filename).name == filename,
                     "Custom typography needs an exact bundled font with a recorded hash.")
            type_profile[role] = filename
            if rtl:
                font_manifest["core_aliases"][type_profile[role+"_family"]] = filename
        type_profile["licenses"] = custom_type.get("licenses", type_profile["licenses"])
        dump(out/"assets/font-manifest.json",font_manifest)
        dump(out/MATERIALS_PATH,materials)
    assets["house-materials"] = {"id":"house-materials","path":MATERIALS_PATH,"kind":"diagram"}
    for shot in shots:
        shot["asset_ids"].append("house-materials")
    if any("paraglider-rig" in shot["asset_ids"] for shot in shots):
        assets["paraglider-rig"] = {"id":"paraglider-rig","path":"scripts/paraglider_rig.cjs","kind":"diagram"}
    if any("type-motion" in shot["asset_ids"] for shot in shots):
        copy_builtin(out,"assets/type-motion.json")
        assets["type-motion"] = {"id":"type-motion","path":"scripts/type_motion.cjs","kind":"diagram"}
        assets["type-style"] = {"id":"type-style","path":"assets/type-motion.json","kind":"diagram"}
    if any("thermal-flow" in shot["asset_ids"] for shot in shots):
        copy_builtin(out,"assets/flow-style.json")
        assets["thermal-flow"] = {"id":"thermal-flow","path":"scripts/thermal_flow.cjs","kind":"diagram"}
        assets["flow-style"] = {"id":"flow-style","path":"assets/flow-style.json","kind":"diagram"}
    if any("thermal-mechanisms" in shot["asset_ids"] for shot in shots):
        copy_builtin(out,"assets/mechanism-style.json")
        assets["thermal-mechanisms"] = {"id":"thermal-mechanisms","path":"scripts/thermal_mechanisms.cjs","kind":"diagram"}
        assets["mechanism-style"] = {"id":"mechanism-style","path":"assets/mechanism-style.json","kind":"diagram"}
    if any("weather-parts" in shot["asset_ids"] for shot in shots):
        assets["weather-parts"] = {"id":"weather-parts","path":"scripts/weather_parts.cjs","kind":"diagram"}
    if any("reference-weather" in shot["asset_ids"] for shot in shots):
        assets["reference-weather"] = {"id":"reference-weather","path":"scripts/reference_weather.cjs","kind":"diagram"}
    assets["scene-graph"] = {"id":"scene-graph","path":"scenes.json","kind":"diagram"}
    assets["scenario-stage"] = {"id":"scenario-stage","path":"scripts/scenario_stage.cjs","kind":"diagram"}
    if use_text:
        language = settings["resolved"]["screen_text"].split("-")[0].casefold()
        typography = materials["type"]["rtl" if language in ("fa","ar","ur") else "en"]
        fonts = [typography["regular"],typography["bold"]]
        for license_file in typography["licenses"]:
            copy_builtin(out,"assets/fonts/"+license_file)
        for role, filename in zip(("regular","bold"),fonts):
            key, path = "type-"+role,"assets/fonts/"+filename
            copy_builtin(out,path)
            assets[key] = {"id":key,"path":path,"kind":"font","font_family":typography[role+"_family"]}
            for shot in shots:
                shot["asset_ids"].append(key)
    if requested_audio.get("bed"):
        required(mode != "silent", "Silent projects cannot have a bed.")
        key, _ = sound(requested_audio["bed"])
        cues.insert(0, {"id":"ambience","kind":"ambience","asset_id":key,"start":0,"end":total/fps,
                       "loop":True,"gain_db":requested_audio.get("bed_gain_db",-14),"stereo_delay_ms":14})
    narration = {"required":mode=="narrated","language":None}
    if mode == "narrated":
        lang = settings["resolved"]["narration"]
        narration.update(language=lang,asset_id="narration")
        assets["narration"] = {"id":"narration","path":"narration.wav","kind":"audio","language":lang}
        dump(out/"voice-script.json",{"language":lang,"beats":script})
    reviews = {key:{"status":"unreviewed","evidence_paths":[]} for key in ("art","style","motion","audio")}
    if mode == "silent":
        reviews["audio"] = {"status":"not_applicable","rationale":"Requested silent animation.","evidence_paths":[]}
    plan = {
        "schema_version":1,"project":{"mode":"scenario","title":recipe["title"],"width":width,
                                       "height":width*16//9,"fps":fps,"duration_seconds":total/fps,
                                       "language":settings},
        "style_anchor":anchor,"assets":list(assets.values()),"beats":beats,"shots":shots,"events":events,
        "audio":{"mode":mode,"requested_silent":mode=="silent","narration":narration,"cues":cues,
                 "mix_target_lufs":requested_audio.get("mix_target_lufs",-14.2)},
        "reviews":reviews,
    }
    if profile is not None:
        plan["project"]["style_profile"] = profile
    if art_reviews:
        reviews_dir = out / "assets/illustration-reviews"
        reviews_dir.mkdir(parents=True, exist_ok=True)
        plan["illustration_reviews"] = {}
        for key, (review, proof) in art_reviews.items():
            if key not in assets:
                continue
            dest = reviews_dir / (key + proof.suffix.lower())
            shutil.copy2(proof, dest)
            plan["illustration_reviews"][key] = {
                "role": review["role"], "observation": review["observation"],
                "art_sha256": hashlib.sha256((out / assets[key]["path"]).read_bytes()).hexdigest(),
                "comparison": dest.relative_to(out).as_posix(),
                "comparison_sha256": hashlib.sha256(dest.read_bytes()).hexdigest(),
            }
    if human_voice:
        plan["audio"]["pending_user_narration"] = True
        write_voice_handoff(recipe, plan, out)
    scenes = {"objects": objects, "shots": graph}
    if settings["resolved"]["screen_text"].split("-")[0].casefold() == "fa":
        scenes = strip_persian_display_marks(scenes)
        plan["project"]["title"] = strip_persian_display_marks(plan["project"]["title"])
    dump(out/"scenes.json", scenes)
    dump(out/"plan.json",plan)
    dump(out/"package.json",{"private":True,"dependencies":{"@napi-rs/canvas":"0.1.100"}})
    subprocess.run([sys.executable,str(out/"scripts/check_project.py"),str(out/"plan.json"),"--mode","final"],
                   check=True, stdout=sys.stderr)
    return {"shots":len(shots),"frames":total,"seconds":total/fps,"languages":settings["resolved"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--recipe", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--reference-style", action="store_true")
    args = parser.parse_args()
    recipe = args.recipe.resolve()
    target = args.out.resolve()
    required(not target.exists(), "Use a fresh project directory.")
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".reel-", dir=target.parent) as temp:
        project = Path(temp)/"project"
        project.mkdir()
        data = json.loads(recipe.read_text(encoding="utf-8"))
        if args.reference_style:
            data.setdefault("style_profile", PROFILE)
        report = compile_recipe(data, recipe.parent, project)
        project.rename(target)
    print(json.dumps({"plan":str(target/"plan.json"),**report},ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, TypeError, OSError, subprocess.CalledProcessError) as exc:
        raise SystemExit(str(exc))
