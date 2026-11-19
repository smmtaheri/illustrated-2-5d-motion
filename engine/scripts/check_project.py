#!/usr/bin/env python3
"""Validate a declared reel production plan, not its artistic quality (stdlib only)."""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from collections import defaultdict
from pathlib import Path


SCHEMA_VERSION = 1
MAX_PROBE_SECONDS = 5.0
MAX_PROBE_SHOTS = 3
MAX_DEAD_HOLD_SECONDS = 1.0
FRAMING_WARNING_SECONDS = 6.0
FRAMING_ERROR_SECONDS = 9.0
VISUAL_KINDS = {"illustration", "diagram", "text"}
ASSET_KINDS = VISUAL_KINDS | {"audio", "font"}
ACTION_CHANNELS = {"position", "deformation", "state", "flow", "rotation", "reveal", "comparison", "scale", "morph"}
REVIEW_METHODS = {
    "art": {"visual_inspection"},
    "style": {"anchor_comparison"},
    "motion": {"camera_locked_playback", "camera_locked_dense_samples"},
    "audio": {"listening"},
}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".webm", ".mkv"}
AUDIO_EXTENSIONS = {".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac"}
LANGUAGE_RE = re.compile(r"^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$")


def number(value):
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def meaningful(value):
    return isinstance(value, str) and bool(value.strip())


def canonical(value):
    """Exact semantic labels after punctuation/case normalization; no similarity score."""
    return re.sub(r"[\W_]+", " ", str(value).casefold(), flags=re.UNICODE).strip()


def language(value):
    return isinstance(value, str) and bool(LANGUAGE_RE.fullmatch(value))


def same_language(left, right):
    return isinstance(left, str) and isinstance(right, str) and left.casefold() == right.casefold()


def media_header(path):
    """Reject empty/renamed score files; this is a format signature, not media QA."""
    try:
        with path.open("rb") as stream:
            header = stream.read(4096)
    except OSError:
        return False
    suffix = path.suffix.lower()
    if suffix == ".png":
        return header.startswith(b"\x89PNG\r\n\x1a\n")
    if suffix in {".jpg", ".jpeg"}:
        return header.startswith(b"\xff\xd8\xff")
    if suffix == ".webp":
        return header.startswith(b"RIFF") and header[8:12] == b"WEBP"
    if suffix == ".gif":
        return header.startswith((b"GIF87a", b"GIF89a"))
    if suffix == ".svg":
        return b"<svg" in header
    if suffix in {".mp4", ".mov", ".m4a"}:
        return header[4:8] == b"ftyp"
    if suffix in {".webm", ".mkv"}:
        return header.startswith(b"\x1aE\xdf\xa3")
    if suffix == ".wav":
        return header.startswith(b"RIFF") and header[8:12] == b"WAVE"
    if suffix == ".flac":
        return header.startswith(b"fLaC")
    if suffix == ".ogg":
        return header.startswith(b"OggS")
    if suffix in {".mp3", ".aac"}:
        return header.startswith(b"ID3") or (len(header) > 1 and header[0] == 255 and header[1] & 224 == 224)
    return False


class Validator:
    def __init__(self, plan, plan_path, mode, manifest=None, require_approvals=False):
        self.plan = plan
        self.plan_path = Path(plan_path).resolve()
        self.base = self.plan_path.parent
        self.mode = mode
        self.manifest = manifest
        self.require_approvals = require_approvals
        self.errors = []
        self.warnings = []
        self.duration = None
        self.fps = 30.0
        self.epsilon = 1e-6
        self.assets = {}
        self.beats = {}
        self.shots = []
        self.used_assets = set()
        self.resolved_languages = {}
        self.review_status = {}
        self.review_evidence_complete = False

    def issue(self, code, location, message, warning=False):
        (self.warnings if warning else self.errors).append({"code": code, "location": location, "message": message})

    def obj(self, value, location):
        if not isinstance(value, dict):
            self.issue("type.object", location, "Expected an object.")
            return {}
        return value

    def array(self, value, location, nonempty=False):
        if not isinstance(value, list):
            self.issue("type.array", location, "Expected an array.")
            return []
        if nonempty and not value:
            self.issue("required.nonempty", location, "At least one entry is required.")
        return value

    def string(self, value, location):
        if not meaningful(value):
            self.issue("required.string", location, "A nonempty string is required.")
            return None
        return value.strip()

    def path(self, value, location, required_now=False):
        value = self.string(value, location)
        if value is None:
            return None
        path = Path(value).expanduser()
        if not path.is_absolute():
            path = self.base / path
        path = path.resolve()
        if not path.is_file():
            self.issue("file.missing", location, f"File does not exist: {value}", warning=not required_now)
        elif not path.stat().st_size:
            self.issue("file.empty", location, f"File is empty: {value}", warning=not required_now)
        return path

    def time_range(self, item, location):
        start, end = item.get("start"), item.get("end")
        if not number(start) or not number(end) or start < 0 or end <= start:
            self.issue("timing.range", location, "Require finite seconds with 0 <= start < end.")
            return None
        if self.duration is not None and end > self.duration + self.epsilon:
            self.issue("timing.bounds", location, "Time range extends beyond project duration.")
        return float(start), float(end)

    def coverage(self, items, location):
        cursor = 0.0
        valid = []
        for i, item in enumerate(items):
            item = self.obj(item, f"{location}[{i}]")
            interval = self.time_range(item, f"{location}[{i}]")
            if interval is None:
                continue
            start, end = interval
            if abs(start - cursor) > self.epsilon:
                relation = "gap" if start > cursor else "overlap or out-of-order range"
                self.issue("timing.coverage", f"{location}[{i}]", f"Contiguous ordered coverage required; {relation} at {cursor:g}s.")
            cursor = end
            valid.append((item, interval, i))
        if self.duration is not None and abs(cursor - self.duration) > self.epsilon:
            self.issue("timing.endpoint", location, f"Coverage ends at {cursor:g}s; expected {self.duration:g}s.")
        return valid

    def project(self):
        if type(self.plan.get("schema_version")) is not int or self.plan.get("schema_version") != SCHEMA_VERSION:
            self.issue("schema.version", "schema_version", f"Expected integer {SCHEMA_VERSION}.")
        project = self.obj(self.plan.get("project"), "project")
        duration = project.get("duration_seconds")
        if not number(duration) or duration <= 0:
            self.issue("project.duration", "project.duration_seconds", "Duration must be a positive finite number.")
        else:
            self.duration = float(duration)
        for key in ("width", "height"):
            value = project.get(key)
            if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
                self.issue("project.dimension", f"project.{key}", "Dimension must be a positive integer.")
        fps = project.get("fps")
        if not number(fps) or fps <= 0:
            self.issue("project.fps", "project.fps", "FPS must be a positive finite number.")
        else:
            self.fps = float(fps)
        if self.mode == "probe" and self.duration is not None and self.duration > MAX_PROBE_SECONDS + self.epsilon:
            self.issue("probe.duration", "project.duration_seconds", "A probe must be <=5 seconds. Trim the plan before rendering.")
        self.languages(project.get("language"))

    def languages(self, value):
        config = self.obj(value, "project.language")
        inputs = self.obj(config.get("input"), "project.language.input")
        resolved = self.obj(config.get("resolved"), "project.language.resolved")
        for key in ("overall", "narration", "dialogue", "screen_text", "subtitles"):
            candidate = inputs.get(key)
            if candidate is not None and not language(candidate):
                self.issue("language.code", f"project.language.input.{key}", "Use a BCP-47 language code or null (for example en, fa, pt-BR).")
        requested = inputs.get("subtitles_requested", False)
        if not isinstance(requested, bool):
            self.issue("language.subtitle_request", "project.language.input.subtitles_requested", "Expected a boolean.")
            requested = False
        overall = inputs.get("overall") if language(inputs.get("overall")) else None
        expected = {}
        for key in ("narration", "dialogue", "screen_text"):
            expected[key] = inputs.get(key) if language(inputs.get(key)) else overall or "en"
        if language(inputs.get("subtitles")):
            expected["subtitles"] = inputs["subtitles"]
        elif requested:
            expected["subtitles"] = overall or expected["narration"]
        else:
            expected["subtitles"] = None
        for key, wanted in expected.items():
            actual = resolved.get(key)
            if key not in resolved:
                self.issue("language.resolved_missing", f"project.language.resolved.{key}", "Write the resolved value explicitly (null for disabled subtitles).")
            elif wanted is None and actual is not None:
                self.issue("language.precedence", f"project.language.resolved.{key}", "Subtitles are off unless requested or explicitly assigned a language.")
            elif wanted is not None and not same_language(actual, wanted):
                self.issue("language.precedence", f"project.language.resolved.{key}", f"Expected {wanted!r}: explicit channel, then overall language, then channel default.")
        self.resolved_languages = expected

    def asset_manifest(self):
        anchor = self.obj(self.plan.get("style_anchor"), "style_anchor")
        anchor_id = self.string(anchor.get("id"), "style_anchor.id")
        material = self.string(anchor.get("material_family"), "style_anchor.material_family")
        anchor_path = self.path(anchor.get("path"), "style_anchor.path", required_now=self.manifest is not None)
        if anchor_path and anchor_path.is_file() and (anchor_path.suffix.lower() not in IMAGE_EXTENSIONS or not media_header(anchor_path)):
            self.issue("style.anchor_format", "style_anchor.path", "The style anchor must be a readable image-format file, not a score or text assertion.")
        assets = self.array(self.plan.get("assets"), "assets", nonempty=True)
        for i, value in enumerate(assets):
            loc = f"assets[{i}]"
            asset = self.obj(value, loc)
            asset_id = self.string(asset.get("id"), f"{loc}.id")
            if asset_id:
                if asset_id in self.assets:
                    self.issue("asset.duplicate_id", f"{loc}.id", f"Duplicate asset ID {asset_id!r}.")
                else:
                    self.assets[asset_id] = asset
            kind = asset.get("kind")
            if not isinstance(kind, str) or kind not in ASSET_KINDS:
                self.issue("asset.kind", f"{loc}.kind", f"Expected one of {', '.join(sorted(ASSET_KINDS))}.")
            asset_path = self.path(asset.get("path"), f"{loc}.path", required_now=self.manifest is not None)
            if kind == "illustration":
                if asset_path and asset_path.is_file() and (asset_path.suffix.lower() not in IMAGE_EXTENSIONS or not media_header(asset_path)):
                    self.issue("asset.illustration_format", f"{loc}.path", "An illustration must be an image-format file; a different media type or renamed text file is invalid.")
                if not meaningful(asset.get("material_family")) or asset.get("material_family") != material:
                    self.issue("style.mixed_material", f"{loc}.material_family", "Every illustration must use the style anchor's exact material_family.")
                lineage = self.obj(asset.get("style_lineage"), f"{loc}.style_lineage")
                if not anchor_id or lineage.get("anchor_id") != anchor_id:
                    self.issue("style.lineage_anchor", f"{loc}.style_lineage.anchor_id", "Every illustration must explicitly inherit the declared style anchor.")
                parents = self.array(lineage.get("source_asset_ids"), f"{loc}.style_lineage.source_asset_ids")
                self.id_list(parents, f"{loc}.style_lineage.source_asset_ids")
            if "language" in asset and kind == "text" and not same_language(asset["language"], self.resolved_languages.get("screen_text")):
                self.issue("language.text", f"{loc}.language", "Text asset language conflicts with resolved screen_text language.")
        edges = {}
        for asset_id, asset in self.assets.items():
            if asset.get("kind") != "illustration":
                continue
            lineage = asset.get("style_lineage")
            parents = lineage.get("source_asset_ids", []) if isinstance(lineage, dict) else []
            edges[asset_id] = [parent for parent in parents if isinstance(parent, str)] if isinstance(parents, list) else []
            for parent in edges[asset_id]:
                source = self.assets.get(parent)
                if source is None:
                    self.issue("style.lineage_reference", f"assets.{asset_id}", f"Unknown source asset {parent!r}.")
                elif source.get("kind") != "illustration":
                    self.issue("style.lineage_kind", f"assets.{asset_id}", "Illustration lineage sources must be illustrations.")
                elif source.get("material_family") != material:
                    self.issue("style.lineage_material", f"assets.{asset_id}", "Lineage source has a different material family.")
        visiting, visited = set(), set()

        def visit(asset_id):
            if asset_id in visiting:
                self.issue("style.lineage_cycle", f"assets.{asset_id}", "Style lineage cannot contain cycles or self-references.")
                return
            if asset_id in visited:
                return
            visiting.add(asset_id)
            for parent in edges.get(asset_id, []):
                visit(parent)
            visiting.remove(asset_id)
            visited.add(asset_id)

        for asset_id in edges:
            visit(asset_id)

    def id_list(self, items, location):
        found = set()
        for i, item in enumerate(items):
            item = self.string(item, f"{location}[{i}]")
            if item is None:
                continue
            if item in found:
                self.issue("reference.duplicate", location, f"Duplicate ID {item!r}.")
            found.add(item)
        return found

    def narrative(self):
        beats = self.array(self.plan.get("beats"), "beats", nonempty=True)
        for beat, interval, i in self.coverage(beats, "beats"):
            beat_id = self.string(beat.get("id"), f"beats[{i}].id")
            self.string(beat.get("meaning"), f"beats[{i}].meaning")
            if "narration_window" in beat and interval is not None:
                window = beat["narration_window"]
                if not (isinstance(window, list) and len(window) == 2 and all(number(v) for v in window)
                        and interval[0]-1e-8 <= window[0] < window[1] <= interval[1]+1e-8):
                    self.issue("beat.narration_window", f"beats[{i}].narration_window",
                               "Keep the speech window within this beat.")
            if beat_id in self.beats:
                self.issue("beat.duplicate_id", f"beats[{i}].id", "Beat IDs must be unique.")
            elif beat_id:
                self.beats[beat_id] = interval
        shots = self.array(self.plan.get("shots"), "shots", nonempty=True)
        if self.mode == "probe" and len(shots) > MAX_PROBE_SHOTS:
            self.issue("probe.shots", "shots", "A probe must contain <=3 shots. Prefer two meaningful shots around two seconds each.")
        seen = {}
        signatures = {}
        semantic_signatures = {}
        for shot, interval, i in self.coverage(shots, "shots"):
            loc = f"shots[{i}]"
            shot_id = self.string(shot.get("id"), f"{loc}.id")
            if shot_id in seen:
                self.issue("shot.duplicate_id", f"{loc}.id", "Shot IDs must be unique.")
            beat_id = shot.get("beat_id")
            if not isinstance(beat_id, str) or beat_id not in self.beats:
                self.issue("shot.beat_reference", f"{loc}.beat_id", "Reference an existing semantic beat.")
            else:
                b_start, b_end = self.beats[beat_id]
                if interval[0] < b_start - self.epsilon or interval[1] > b_end + self.epsilon:
                    self.issue("shot.beat_bounds", loc, "Each shot must fit inside its parent beat; split a shot at a beat boundary.")
            for key in ("view", "layout_id", "focal_subject", "new_information"):
                self.string(shot.get(key), f"{loc}.{key}")
            asset_ids = self.id_list(self.array(shot.get("asset_ids"), f"{loc}.asset_ids", nonempty=True), f"{loc}.asset_ids")
            self.used_assets.update(asset_ids)
            for asset_id in asset_ids:
                if asset_id not in self.assets:
                    self.issue("shot.unplanned_asset", f"{loc}.asset_ids", f"Unplanned asset {asset_id!r}; add it to the manifest before using it.")
            focal = shot.get("focal_subject")
            if meaningful(focal) and focal not in asset_ids:
                self.issue("shot.focal_reference", f"{loc}.focal_subject", "The focal_subject must be a visual asset ID used in this shot.")
            elif isinstance(focal, str) and focal in self.assets and self.assets[focal].get("kind") not in tuple(VISUAL_KINDS):
                self.issue("shot.focal_kind", f"{loc}.focal_subject", "The focal subject must be visual.")
            action = self.obj(shot.get("primary_action"), f"{loc}.primary_action")
            self.action(action, asset_ids, interval, f"{loc}.primary_action")
            self.transition(shot.get("transition"), interval, f"{loc}.transition")
            reprise = shot.get("intentional_reprise_of")
            valid_reprise = False
            if reprise is not None:
                if not meaningful(reprise) or reprise not in seen:
                    self.issue("shot.reprise_reference", f"{loc}.intentional_reprise_of", "A reprise must name a prior shot.")
                elif seen[reprise] == i - 1:
                    self.issue("shot.reprise_adjacent", loc, "A reprise returns after a different shot; consecutive repetition is not a callback.")
                elif not meaningful(shot.get("reprise_reason")):
                    self.issue("shot.reprise_reason", f"{loc}.reprise_reason", "State the narrative purpose of returning to that shot.")
                else:
                    valid_reprise = True
            frame_key = tuple(canonical(shot.get(key, "")) for key in ("view", "layout_id", "focal_subject"))
            action_key = frame_key + tuple(canonical(action.get(key, "")) for key in ("subject", "channel", "description"))
            semantic_key = frame_key + (canonical(shot.get("new_information", "")),)
            if action_key in signatures and not valid_reprise:
                self.issue("shot.repeated_action", loc, f"Same framing, focal subject and primary action as {signatures[action_key]!r}; changing labels alone is not a new shot.")
            elif semantic_key in semantic_signatures and not valid_reprise:
                self.issue("shot.repeated_information", loc, f"Same framing and new_information as {semantic_signatures[semantic_key]!r}; add an explanation or declare a purposeful callback.")
            if shot_id:
                signatures.setdefault(action_key, shot_id)
                semantic_signatures.setdefault(semantic_key, shot_id)
                seen.setdefault(shot_id, i)
            self.shots.append((shot, interval, i))
        self.framing()

    def action(self, action, asset_ids, interval, loc):
        subject = self.string(action.get("subject"), f"{loc}.subject")
        if subject and subject not in asset_ids:
            self.issue("action.subject_reference", f"{loc}.subject", "The primary-action subject must be a shot asset ID.")
        if subject in self.assets and self.assets[subject].get("kind") not in ("illustration", "diagram"):
            self.issue("action.subject_kind", f"{loc}.subject", "A primary explanatory action must change an illustration or diagram; label/font/audio changes do not qualify.")
        if not isinstance(action.get("channel"), str) or action.get("channel") not in ACTION_CHANNELS:
            self.issue("action.channel", f"{loc}.channel", f"Use an independent object channel: {', '.join(sorted(ACTION_CHANNELS))}. Camera-only or none is invalid.")
        self.string(action.get("description"), f"{loc}.description")
        a_start, a_end = action.get("active_start"), action.get("active_end")
        if not number(a_start) or not number(a_end) or a_end <= a_start:
            self.issue("action.interval", loc, "Require active_start < active_end in absolute project seconds.")
            return
        start, end = interval
        if a_start < start - self.epsilon or a_end > end + self.epsilon:
            self.issue("action.bounds", loc, "The primary action interval must be contained in the shot.")
        for side, hold in (("leading", a_start - start), ("trailing", end - a_end)):
            if hold > MAX_DEAD_HOLD_SECONDS + self.epsilon:
                self.issue("action.dead_hold", loc, f"{side.capitalize()} dead hold is {hold:g}s; maximum is 1s. Recut, continue the mechanism, or split the shot.")
        if a_end - a_start < (end - start) * 0.5:
            self.issue("action.low_activity", loc, "The primary action occupies less than half this shot; inspect pacing and useful reading time.", warning=True)

    def transition(self, value, interval, loc):
        if isinstance(value, str):
            kind, duration = value, 0
        elif isinstance(value, dict):
            kind, duration = value.get("type"), value.get("duration_seconds", 0)
        else:
            self.issue("transition.type", loc, "Use a transition name or {type, duration_seconds}.")
            return
        if not isinstance(kind, str) or kind not in {"cut", "fade", "dissolve", "match_cut", "none", "wipe", "slide", "zoom_dissolve", "dip"}:
            self.issue("transition.kind", loc, "Use cut, fade, dissolve, match_cut, none, wipe, slide, zoom_dissolve, or dip.")
        if not number(duration) or duration < 0 or duration > interval[1] - interval[0]:
            self.issue("transition.duration", loc, "Transition duration must fit in the shot.")
        if isinstance(value, dict) and "progress_keys" in value:
            keys = value["progress_keys"]
            valid = isinstance(keys, list) and len(keys) >= 2 and all(isinstance(k, list) and len(k) == 2 and all(number(v) for v in k) for k in keys)
            if valid:
                valid = keys[0] == [0, 0] and keys[-1][1] == 1 and all(0 <= k[1] <= 1 for k in keys) and all(a[0] < b[0] and a[1] <= b[1] for a, b in zip(keys, keys[1:]))
            if not valid:
                self.issue("transition.progress_keys", loc, "Use increasing local-frame/progress pairs, from [0,0] to progress 1, monotonically within [0,1].")
        if isinstance(value, dict):
            tracks = (
                ("edge_keys", "wipe", 3, "top x, bottom x and positive glow width"),
                ("outgoing_camera_keys", "zoom_dissolve", 1, "positive scale, x and y"),
            )
            for field, expected, positive, description in tracks:
                if field not in value:
                    continue
                keys = value[field]
                valid = (
                    kind == expected and number(duration) and duration > 0
                    and isinstance(keys, list) and len(keys) >= 2
                    and all(isinstance(k, list) and len(k) == 4 and all(number(v) for v in k) for k in keys)
                )
                if valid:
                    valid = keys[0][0] == 0 and all(k[positive] > 0 for k in keys)
                    valid = valid and all(a[0] < b[0] for a, b in zip(keys, keys[1:]))
                if not valid:
                    self.issue(f"transition.{field}", loc, f"Use increasing local-frame keys starting at 0 with {description} for a {expected} transition.")

    def framing(self):
        run, run_key = [], None
        exposure = defaultdict(float)

        def finish():
            if not run:
                return
            duration = run[-1][1][1] - run[0][1][0]
            loc = f"shots[{run[0][2]}..{run[-1][2]}]"
            if duration > FRAMING_ERROR_SECONDS + self.epsilon:
                self.issue("framing.long_run", loc, f"The same view/layout holds for {duration:g}s (>9s). Plan a meaningful viewpoint/composition change.")
            elif duration > FRAMING_WARNING_SECONDS + self.epsilon:
                self.issue("framing.long_run", loc, f"The same view/layout holds for {duration:g}s (>6s); inspect whether this duration serves one mechanism.", warning=True)

        for shot, interval, i in self.shots:
            key = tuple(canonical(shot.get(k, "")) for k in ("view", "layout_id"))
            exposure[key] += interval[1] - interval[0]
            if key != run_key:
                finish()
                run = []
            run_key = key
            run.append((shot, interval, i))
        finish()
        if self.duration:
            for key, duration in exposure.items():
                if duration > FRAMING_WARNING_SECONDS and duration > self.duration / 2 + self.epsilon:
                    self.issue("framing.dominant_layout", "shots", f"View/layout {key!r} occupies {duration:g}s of {self.duration:g}s; inspect framing variety.", warning=True)

    def audio(self):
        config = self.obj(self.plan.get("audio"), "audio")
        mode = config.get("mode")
        if not isinstance(mode, str) or mode not in {"narrated", "sound_only", "silent"}:
            self.issue("audio.mode", "audio.mode", "Use narrated, sound_only, or silent.")
        narration = self.obj(config.get("narration"), "audio.narration")
        required = narration.get("required")
        if not isinstance(required, bool):
            self.issue("audio.narration_required", "audio.narration.required", "Expected a boolean.")
        if mode == "narrated" and required is not True:
            self.issue("audio.narration_mode", "audio.narration.required", "Narrated output requires narration.")
        if isinstance(mode, str) and mode in {"silent", "sound_only"} and required is not False:
            self.issue("audio.narration_mode", "audio.narration.required", "Silent/sound_only output must disable narration.")
        if required:
            if not same_language(narration.get("language"), self.resolved_languages.get("narration")):
                self.issue("language.narration", "audio.narration.language", "Narration must use the resolved narration language.")
            asset_id = narration.get("asset_id")
            if asset_id is None:
                self.issue("audio.narration_asset", "audio.narration.asset_id", "Declare the narration audio asset before rendering.", warning=self.manifest is None)
            else:
                self.audio_asset(asset_id, "audio.narration.asset_id")
        music = config.get("music")
        if music is not None:
            from music_bus import validate_music
            try:
                validate_music(music, self.plan["project"]["duration_seconds"])
                self.audio_asset(music.get("asset_id"), "audio.music.asset_id")
            except (ValueError, KeyError, TypeError) as exc:
                self.issue("audio.music", "audio.music", str(exc))
            if mode == "silent" or narration.get("preserve_reference_mix"):
                self.issue("audio.music_mode", "audio.music", "Do not add music to a silent project or preserved reference master.")
        cues = self.array(config.get("cues"), "audio.cues")
        if narration.get('preserve_reference_mix'):
            if required is not True or cues or narration.get('start', 0) != 0:
                self.issue('audio.reference_master', 'audio.narration', 'A preserved master requires one required full mix on the zero source clock, without added cues.')
            if narration.get('isolated_stem') is not False:
                self.issue('audio.reference_master_stem', 'audio.narration', 'A reference full mix must declare isolated_stem=false.')
            digest = narration.get('source_sha256', '')
            if not isinstance(digest, str) or not re.fullmatch(r'[0-9a-f]{64}', digest):
                self.issue('audio.reference_master_hash', 'audio.narration.source_sha256', 'Declare the validated SHA-256 of the reference mix.')
        if mode == "silent" and cues:
            self.issue("audio.silent_cues", "audio.cues", "A silent output cannot contain audio cues.")
        if mode == "sound_only" and not cues and not music and config.get("pending_user_narration") is not True:
            self.issue("audio.no_cues", "audio.cues", "Sound-only output requires at least one planned audio cue.")
        if music and any(isinstance(c, dict) and c.get("kind") == "music" for c in cues):
            self.issue("audio.duplicate_music", "audio.music", "Do not declare both audio.music and a music cue.")
        seen = set()
        shot_map = {shot.get("id"): interval for shot, interval, _ in self.shots if isinstance(shot.get("id"), str)}
        for i, value in enumerate(cues):
            loc = f"audio.cues[{i}]"
            cue = self.obj(value, loc)
            cue_id = self.string(cue.get("id"), f"{loc}.id")
            if cue_id in seen:
                self.issue("audio.duplicate_cue", f"{loc}.id", "Cue IDs must be unique.")
            seen.add(cue_id)
            kind = cue.get("kind")
            if not isinstance(kind, str) or kind not in {"ambience", "sfx", "music", "narration", "dialogue"}:
                self.issue("audio.cue_kind", f"{loc}.kind", "Use ambience, sfx, music, narration, or dialogue.")
            if isinstance(kind, str) and kind in {"narration", "dialogue"} and not same_language(cue.get("language"), self.resolved_languages.get(kind)):
                self.issue("language.spoken_cue", f"{loc}.language", f"Spoken cue language must match resolved {kind} language.")
            pan, spread = cue.get("stereo_pan", 0), cue.get("stereo_delay_ms", 0)
            if not number(pan) or not -1 <= pan <= 1:
                self.issue("audio.stereo_pan", f"{loc}.stereo_pan", "Use a number from -1 for left through 1 for right.")
            if type(spread) is not int or not 0 <= spread <= 25:
                self.issue("audio.stereo_delay", f"{loc}.stereo_delay_ms", "Use an integer right-channel delay from 0 to 25 milliseconds.")
            interval = self.time_range(cue, loc)
            if "gain_keys" in cue:
                keys = cue["gain_keys"]
                valid = isinstance(keys, list) and len(keys) >= 2 and all(
                    isinstance(k, list) and len(k) == 2 and number(k[0])
                    and number(k[1]) and -60 <= k[1] <= 18 for k in keys
                )
                if valid:
                    valid = keys[0][0] == 0 and all(a[0] < b[0] for a, b in zip(keys, keys[1:]))
                    valid = valid and interval is not None and keys[-1][0] <= interval[1] - interval[0] + self.epsilon
                if not valid:
                    self.issue("audio.gain_keys", f"{loc}.gain_keys", "Use increasing cue-relative seconds and dB pairs beginning at time zero and staying inside the cue.")
            self.audio_asset(cue.get("asset_id"), f"{loc}.asset_id")
            if "shot_id" in cue:
                shot_id = cue["shot_id"]
                if not isinstance(shot_id, str) or shot_id not in shot_map:
                    self.issue("audio.shot_reference", f"{loc}.shot_id", "Cue references an unknown shot.")
                elif interval:
                    start, end = shot_map[shot_id]
                    if interval[0] < start - self.epsilon or interval[1] > end + self.epsilon:
                        self.issue("audio.shot_bounds", loc, "Shot-scoped audio cue extends beyond its shot; omit shot_id for a deliberate cross-shot cue.")

    def audio_asset(self, asset_id, loc):
        asset_id = self.string(asset_id, loc)
        if not asset_id:
            return
        self.used_assets.add(asset_id)
        if asset_id not in self.assets:
            self.issue("audio.unplanned_asset", loc, f"Unplanned audio asset {asset_id!r}.")
        elif self.assets[asset_id].get("kind") != "audio":
            self.issue("audio.asset_kind", loc, "Audio references must use kind=audio assets.")

    def reviews(self):
        reviews = self.obj(self.plan.get("reviews"), "reviews")
        complete = True
        for name, methods in REVIEW_METHODS.items():
            loc = f"reviews.{name}"
            review = self.obj(reviews.get(name), loc)
            status = review.get("status")
            self.review_status[name] = status
            before = len(self.errors)
            if any("score" in key.casefold() or "rating" in key.casefold() for key in review):
                self.issue("review.score_not_evidence", loc, "Do not use self-declared scores/ratings as evidence. Record method, observations, reviewer, and reviewed media.")
            if status == "unreviewed":
                complete = False
                paths = self.array(review.get("evidence_paths"), f"{loc}.evidence_paths")
                if paths:
                    self.issue("review.unreviewed_evidence", loc, "Unreviewed checks must have evidence_paths=[]; evidence belongs to a performed review.")
                if self.require_approvals:
                    self.issue("review.required", loc, "This check is unreviewed; a final handoff cannot claim it was approved.")
            elif status == "not_applicable" and name == "audio":
                audio = self.plan.get("audio", {})
                if not isinstance(audio, dict) or audio.get("mode") != "silent" or audio.get("requested_silent") is not True:
                    self.issue("review.audio_na", loc, "Audio may be not_applicable only for explicitly requested silent output (audio.requested_silent=true).")
                self.string(review.get("rationale"), f"{loc}.rationale")
                paths = self.array(review.get("evidence_paths"), f"{loc}.evidence_paths")
                if paths:
                    self.issue("review.audio_na_evidence", loc, "Use evidence_paths=[] for an inapplicable audio review.")
            elif status == "approved":
                self.string(review.get("reviewer"), f"{loc}.reviewer")
                findings = self.string(review.get("findings"), f"{loc}.findings")
                if findings and re.fullmatch(r"[\s\d/.,%:+-]*(?:(?:score|rating|quality|approved|perfect|pass|out of)[\s\d/.,%:+-]*)*", findings, flags=re.IGNORECASE):
                    self.issue("review.findings", f"{loc}.findings", "A score or approval word alone is not an observation.")
                method = review.get("method")
                if not isinstance(method, str) or method not in methods:
                    self.issue("review.method", f"{loc}.method", f"Use an actual applicable review method: {', '.join(sorted(methods))}. Technical checks alone cannot approve this category.")
                paths = self.array(review.get("evidence_paths"), f"{loc}.evidence_paths", nonempty=True)
                media_found = False
                if name in {"art", "style"}:
                    allowed = IMAGE_EXTENSIONS
                elif name == "motion":
                    allowed = IMAGE_EXTENSIONS if method == "camera_locked_dense_samples" else VIDEO_EXTENSIONS
                else:
                    allowed = AUDIO_EXTENSIONS | VIDEO_EXTENSIONS
                for j, value in enumerate(paths):
                    path = self.path(value, f"{loc}.evidence_paths[{j}]", required_now=True)
                    if path and path.is_file() and path.suffix.lower() in allowed and media_header(path):
                        media_found = True
                if not media_found:
                    self.issue("review.media_evidence", loc, "Approval requires existing reviewed media of the applicable type; a score file/report alone is insufficient.")
            else:
                self.issue("review.status", f"{loc}.status", "Use unreviewed or approved; audio also allows not_applicable with a silent-request rationale.")
            if len(self.errors) != before:
                complete = False
        self.review_evidence_complete = complete
        unreviewed = [name for name, status in self.review_status.items() if status == "unreviewed"]
        if unreviewed and not self.require_approvals:
            self.issue("review.pending", "reviews", "Unreviewed: " + ", ".join(unreviewed) + ". Plan/technical success does not approve art, style, motion, or audio.", warning=True)

    def render_inventory(self):
        if self.manifest is None:
            self.issue("render.inventory_unchecked", "render_manifest", "Actual renderer asset consumption has not been checked; use --render-manifest for a rendered artifact.", warning=True)
            if self.require_approvals:
                self.issue("render.inventory_required", "render_manifest", "Final handoff checks require --render-manifest from the renderer's actual consumed assets.")
            return
        manifest = self.obj(self.manifest, "render_manifest")
        actual = self.id_list(self.array(manifest.get("asset_ids"), "render_manifest.asset_ids"), "render_manifest.asset_ids")
        extra = actual - self.used_assets
        missing = self.used_assets - actual
        if extra:
            self.issue("render.unplanned_assets", "render_manifest.asset_ids", f"Renderer consumed assets outside the planned shot/audio scope: {', '.join(sorted(extra))}.")
        if missing:
            self.issue("render.missing_assets", "render_manifest.asset_ids", f"Renderer did not consume planned assets: {', '.join(sorted(missing))}.")
        expected_shots = [shot.get("id") for shot, _, _ in self.shots]
        actual_shots = self.array(manifest.get("shot_ids"), "render_manifest.shot_ids")
        self.id_list(actual_shots, "render_manifest.shot_ids")
        if actual_shots != expected_shots:
            self.issue("render.shot_scope", "render_manifest.shot_ids", "Rendered shot IDs/order must exactly match this plan.")
        duration = manifest.get("duration_seconds")
        if not number(duration) or self.duration is None or abs(duration - self.duration) > self.epsilon:
            self.issue("render.duration", "render_manifest.duration_seconds", "Renderer duration must match this plan, including probe limits.")
        for key in ("width", "height", "fps"):
            project = self.plan.get("project")
            if key in manifest and (not isinstance(project, dict) or manifest[key] != project.get(key)):
                self.issue("render.settings", f"render_manifest.{key}", "Renderer setting conflicts with the plan.")
        if "asset_paths" in manifest:
            paths = self.obj(manifest["asset_paths"], "render_manifest.asset_paths")
            if set(paths) != actual:
                self.issue("render.path_scope", "render_manifest.asset_paths", "asset_paths keys must exactly match rendered asset_ids.")
            for asset_id, path in paths.items():
                declared = self.assets.get(asset_id, {}).get("path")
                if not meaningful(path) or not meaningful(declared):
                    self.issue("render.asset_path", f"render_manifest.asset_paths.{asset_id}", "Require the consumed path of a declared asset.")
                    continue
                observed = Path(path).expanduser()
                expected = Path(declared).expanduser()
                observed = (self.base / observed).resolve() if not observed.is_absolute() else observed.resolve()
                expected = (self.base / expected).resolve() if not expected.is_absolute() else expected.resolve()
                if observed != expected:
                    self.issue("render.asset_substitution", f"render_manifest.asset_paths.{asset_id}", "Renderer consumed a different file than the declared asset path.")
        else:
            self.issue("render.paths_unchecked", "render_manifest.asset_paths", "Consumed asset IDs were checked, but file substitution is unverified without actual asset_paths.", warning=not self.require_approvals)

    def run(self):
        if not isinstance(self.plan, dict):
            self.issue("type.object", "plan", "The plan root must be an object.")
        else:
            self.project()
            self.asset_manifest()
            self.narrative()
            self.audio()
            self.reviews()
            self.render_inventory()
            if not self.errors and self.plan["project"].get("style_profile"):
                from reference_style import PROFILES, check_reference_plan
                try:
                    profile = self.plan["project"]["style_profile"]
                    if profile not in PROFILES:
                        raise ValueError("Unknown reference style.")
                    check_reference_plan(self.plan, self.base, None)
                except (ValueError, KeyError, TypeError, OSError) as exc:
                    self.issue("style.reference_profile", "project.style_profile", str(exc))
        return {
            "schema_version": SCHEMA_VERSION,
            "mode": self.mode,
            "plan_path": str(self.plan_path),
            "passed": not self.errors,
            "errors": self.errors,
            "warnings": self.warnings,
            "review_status": self.review_status,
            "review_evidence_complete": self.review_evidence_complete,
            "render_manifest_checked": self.manifest is not None,
            "approval_scope": "Declared plan structure and evidence presence only; never an artistic score or an automatic art/style/motion/audio approval.",
        }


def load_json(path):
    def unique_keys(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"Duplicate JSON key {key!r}")
            result[key] = value
        return result

    with Path(path).open("r", encoding="utf-8") as stream:
        return json.load(stream, object_pairs_hook=unique_keys, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(f"Non-finite JSON number {value}")))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("plan", type=Path, help="Production-plan JSON; relative file paths resolve beside it.")
    parser.add_argument("--mode", choices=("probe", "final"), required=True, help="probe enforces <=5 seconds and <=3 shots; final lints full scope.")
    parser.add_argument("--render-manifest", type=Path, help="JSON inventory emitted by the renderer from assets actually consumed.")
    parser.add_argument("--require-approvals", action="store_true", help="Require performed separate reviews and a renderer inventory for final handoff.")
    parser.add_argument("--json", action="store_true", help="Print one machine-readable report.")
    args = parser.parse_args(argv)
    if args.require_approvals and args.mode != "final":
        parser.error("--require-approvals is a final-handoff check; probes may remain unreviewed.")
    try:
        plan = load_json(args.plan)
        manifest = load_json(args.render_manifest) if args.render_manifest else None
        if args.render_manifest and manifest is None:
            raise ValueError("Render manifest root must be an object, not null.")
        report = Validator(plan, args.plan, args.mode, manifest, args.require_approvals).run()
    except (OSError, ValueError, RecursionError) as error:
        if args.json:
            print(json.dumps({"passed": False, "errors": [{"code": "input.read", "location": "input", "message": str(error)}]}, ensure_ascii=False))
        else:
            print(f"INPUT ERROR: {error}", file=sys.stderr)
        return 2
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print("PLAN PASS" if report["passed"] else "PLAN FAIL")
        print("Structure/evidence checks only; art, style, motion and audio approval remain separate.")
        for level in ("errors", "warnings"):
            for issue in report[level]:
                print(f"{level[:-1].upper()} [{issue['code']}] {issue['location']}: {issue['message']}")
        print("Review evidence complete: " + ("yes (presence checked; quality not certified)" if report["review_evidence_complete"] else "no"))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
