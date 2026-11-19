#!/usr/bin/env python3
"""Build a separate music gain envelope from local narration RMS and cue clocks.

Standard library + FFmpeg only; no ASR, model, network, narration processing or
perceptual approval. The public skill carries the same portable helper.
"""
from __future__ import annotations

from array import array
from copy import deepcopy
import hashlib
import math
from pathlib import Path
import subprocess
import sys

DEFAULTS = {
    "gain_db": -19.0, "fade_in_seconds": .35, "fade_out_seconds": .55,
    "ducking": {"reduction_db": 7.0, "threshold_dbfs": -40.0,
                "attack_seconds": .04, "release_seconds": .28,
                "foreground_reduction_db": 3.0},
    "quiet_intervals": [],
}


def number(value, low, high, name):
    if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f"Music {name} must be a finite number in [{low}, {high}].")


def validate_music(config, duration=None):
    if not isinstance(config, dict):
        raise ValueError("audio.music must be an object, or omitted.")
    allowed = set(DEFAULTS) | {"sound", "asset_id"}
    for key in ("sound", "asset_id"):
        if key in config and (not isinstance(config[key], str) or not config[key]):
            raise ValueError(f"Music {key} must be a nonempty asset ID.")
    if set(config) - allowed:
        raise ValueError("Unknown audio.music fields: " + ", ".join(sorted(set(config) - allowed)))
    result = deepcopy(DEFAULTS)
    result.update({k: deepcopy(v) for k, v in config.items() if k != "ducking"})
    if not isinstance(config.get("ducking", {}), dict):
        raise ValueError("audio.music.ducking must be an object.")
    if set(config.get("ducking", {})) - set(DEFAULTS["ducking"]):
        raise ValueError("Unknown music ducking setting.")
    result["ducking"].update(config.get("ducking", {}))
    if not any(isinstance(result.get(k), str) and result[k] for k in ("sound", "asset_id")):
        raise ValueError("audio.music needs a declared WAV sound/asset_id.")
    for key, low, high in (("gain_db", -60, 0), ("fade_in_seconds", 0, 10), ("fade_out_seconds", 0, 10)):
        number(result[key], low, high, key)
    for key, low, high in (("reduction_db", 0, 24), ("threshold_dbfs", -70, -15),
                          ("attack_seconds", .01, 1), ("release_seconds", .03, 3),
                          ("foreground_reduction_db", 0, 18)):
        number(result["ducking"][key], low, high, key)
    if not isinstance(result["quiet_intervals"], list):
        raise ValueError("Music quiet_intervals must be [start, end] pairs.")
    last = -1
    for interval in result["quiet_intervals"]:
        if not isinstance(interval, list) or len(interval) != 2:
            raise ValueError("Music quiet intervals need [start, end].")
        first, end = interval
        number(first, 0, duration or 86400, "quiet interval start")
        number(end, 0, duration or 86400, "quiet interval end")
        if not last <= first < end:
            raise ValueError("Music quiet intervals must be ordered and disjoint.")
        last = end
    if duration is not None and result["fade_in_seconds"] + result["fade_out_seconds"] > duration:
        raise ValueError("Music fades exceed the project duration.")
    return result


def speech_intervals(source, offset, duration, threshold_dbfs, gap):
    rate, frame = 8000, 160
    raw = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", str(source),
                          "-map", "0:a:0", "-ac", "1", "-ar", str(rate),
                          "-f", "f32le", "-"], check=True, capture_output=True).stdout
    samples = array("f")
    samples.frombytes(raw)
    if sys.byteorder != "little":
        samples.byteswap()
    threshold = 10 ** (threshold_dbfs / 20)
    intervals = []
    for index in range(0, len(samples), frame):
        block = samples[index:index + frame]
        rms = math.sqrt(sum(x*x for x in block) / len(block))
        if rms < threshold:
            continue
        start, end = offset + index/rate, min(duration, offset + (index+len(block))/rate)
        if end <= 0 or start >= duration:
            continue
        start = max(0, start)
        if intervals and start - intervals[-1][1] <= gap:
            intervals[-1][1] = end
        else:
            intervals.append([start, end])
    return intervals


def _ramp(t, first, start, end, last):
    if t <= first or t >= last:
        return 0.0
    if t < start:
        return (t-first) / max(1e-9, start-first)
    if t <= end:
        return 1.0
    return (last-t) / max(1e-9, last-end)


def music_cue(plan, base):
    """Return a music cue/report; never mutate narration, ambience or SFX cues."""
    audio = plan["audio"]
    if not audio.get("music"):
        return None, None
    if audio.get("narration", {}).get("preserve_reference_mix"):
        raise ValueError("Do not layer music onto a preserved reference master.")
    if any(c.get("kind") == "music" for c in audio.get("cues", [])):
        raise ValueError("audio.music would duplicate an existing music cue.")
    duration = float(plan["project"]["duration_seconds"])
    config = validate_music(audio["music"], duration)
    assets = {item["id"]: item for item in plan["assets"]}
    music_id = config.get("asset_id", config.get("sound"))
    if music_id not in assets or assets[music_id]["kind"] != "audio":
        raise ValueError("Music asset is not bound in plan.assets.")
    n = audio.get("narration", {})
    d = config["ducking"]
    intervals, voice_hash = [], None
    if n.get("required"):
        source = (Path(base) / assets[n["asset_id"]]["path"]).resolve()
        intervals = speech_intervals(source, float(n.get("start", 0)), duration,
                                     d["threshold_dbfs"], d["release_seconds"])
        voice_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    events = {event["id"]: event["time"] for event in plan.get("events", [])}
    foreground = []
    for cue in audio.get("cues", []):
        if cue.get("foreground"):
            start = events[cue["event_id"]] + cue.get("offset", 0) if cue.get("event_id") else cue["start"]
            end = start + cue.get("duration_seconds", cue["end"]-cue["start"])
            foreground.append([float(start), float(end)])
    breakpoints = {0., duration, config["fade_in_seconds"], duration-config["fade_out_seconds"]}
    for pairs, attack, release in ((intervals, d["attack_seconds"], d["release_seconds"]),
                                  (foreground, .04, .18), (config["quiet_intervals"], .05, .05)):
        for start, end in pairs:
            breakpoints.update((max(0, start-attack), max(0, start), min(duration, end), min(duration, end+release)))
    # Include a fixed 20 ms clock to resolve intersecting envelopes. Simplify
    # collinear dB segments to keep the FFmpeg expression small and inspectable.
    breakpoints.update(round(i*.02, 6) for i in range(math.ceil(duration/.02)) if i*.02 < duration)
    keys = []
    for time in sorted(breakpoints):
        speech = max((_ramp(time, start-d["attack_seconds"], start, end, end+d["release_seconds"])
                      for start, end in intervals), default=0) * d["reduction_db"]
        sfx = max((_ramp(time, start-.04, start, end, end+.18)
                   for start, end in foreground), default=0) * d["foreground_reduction_db"]
        quiet = max((_ramp(time, start-.05, start, end, end+.05)
                     for start, end in config["quiet_intervals"]), default=0) * 90
        fade_in = 90 * max(0, 1-time/config["fade_in_seconds"]) if config["fade_in_seconds"] else 0
        fade_out = 90 * max(0, 1-(duration-time)/config["fade_out_seconds"]) if config["fade_out_seconds"] else 0
        db = round(max(-100, config["gain_db"] - max(speech, sfx, quiet, fade_in, fade_out)), 5)
        keys.append([round(time, 6), db])
        while len(keys) >= 3:
            (ta, a), (tb, b), (tc, c) = keys[-3:]
            predicted = a + (c-a)*(tb-ta)/(tc-ta)
            if abs(predicted-b) > .015:
                break
            keys.pop(-2)
    cue = {"id": "background-music", "kind": "music", "asset_id": music_id,
           "start": 0, "end": duration, "loop": True, "gain_db": config["gain_db"], "gain_keys": keys}
    report = {"method": "local 20ms RMS speech envelope; music bus only", "config": config,
              "speech_intervals": intervals, "foreground_intervals": foreground,
              "narration_sha256": voice_hash, "music_sha256": hashlib.sha256((Path(base)/assets[music_id]["path"]).read_bytes()).hexdigest(),
              "gain_keys": keys, "other_cues_modified": False, "narration_modified": False,
              "listening_performed": False, "perceptual_approval": False}
    return cue, report
