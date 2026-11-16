#!/usr/bin/env python3
"""Check protected cue alignment and speech clearance in the delivered MP4."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess

import numpy as np

SAMPLE_RATE = 12000


def decode(path):
    result = subprocess.run([
        "ffmpeg", "-v", "error", "-nostdin", "-i", str(path), "-map", "0:a:0",
        "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "-"
    ], capture_output=True, check=True)
    return np.frombuffer(result.stdout, dtype="<f4").astype(np.float64)


def peak_db(samples):
    return round(float(20*np.log10(max(1e-9, np.max(np.abs(samples), initial=0)))), 2)


def match_cue(mix, reference, at, radius):
    first = max(0, at-radius)
    last = min(len(mix), at+radius+len(reference))
    window = mix[first:last]
    reference = reference - reference.mean()
    norm = np.linalg.norm(reference)
    if len(window) < len(reference) or norm < 1e-8:
        return None, None
    numerator = np.correlate(window, reference, mode="valid")
    width = len(reference)
    cumulative = np.r_[0, np.cumsum(window)]
    squared = np.r_[0, np.cumsum(window**2)]
    sums = cumulative[width:] - cumulative[:-width]
    energies = squared[width:] - squared[:-width] - sums**2 / width
    denominator = norm * np.sqrt(np.maximum(1e-12, energies))
    coefficients = numerator / denominator
    best = int(np.argmax(coefficients))
    return round((first+best-at)*1000/SAMPLE_RATE, 3), round(float(coefficients[best]), 4)


def loudness(video):
    result = subprocess.run([
        "ffmpeg", "-hide_banner", "-nostdin", "-i", str(video),
        "-map", "0:a:0", "-af", "ebur128=peak=true", "-vn", "-f", "null", "-"
    ], capture_output=True, check=True, text=True)
    summary = result.stderr.rsplit("Summary:", 1)[-1]
    integrated = re.search(r"\bI:\s*(-?[\d.]+) LUFS", summary)
    peak = re.search(r"\bPeak:\s*(-?[\d.]+) dBFS", summary)
    if not integrated or not peak:
        raise ValueError("Cannot measure the delivered audio.")
    return float(integrated[1]), float(peak[1])


def audit(plan_path, video):
    plan = json.loads(plan_path.read_text())
    base = plan_path.resolve().parent
    audio = plan["audio"]
    if audio["mode"] == "silent":
        return {"applicable": False, "direct_listening": False, "technical_pass": None}
    fps = plan["project"]["fps"]
    duration = plan["project"]["duration_seconds"]
    assets = {a["id"]: base/a["path"] for a in plan["assets"]}
    events = {event["id"]: event["time"] for event in plan.get("events", [])}
    mix = decode(video)
    narration = audio.get("narration", {})
    voice_required = narration.get("required", False)
    voice_isolated = narration.get("isolated_stem", True)
    voice = decode(assets[narration["asset_id"]]) if voice_required and voice_isolated else None
    voice_start = round(narration.get("start", 0)*SAMPLE_RATE)
    clips = []
    for cue in audio.get("cues", []):
        if not cue.get("foreground"):
            continue
        at = (events[cue["event_id"]] + cue.get("offset", 0)
              if cue.get("event_id") else cue["start"])
        # dict.get evaluates its default eagerly, even when duration_seconds exists.
        seconds = cue["duration_seconds"] if "duration_seconds" in cue else cue["end"]-cue["start"]
        count = round(seconds * SAMPLE_RATE)
        index = round(at*SAMPLE_RATE)
        ref = decode(assets[cue["asset_id"]])[:min(count, round(.28*SAMPLE_RATE))]
        offset, correlation = match_cue(mix, ref, index, round(3*SAMPLE_RATE/fps)) if len(ref) else (None, None)
        voice_offset = index-voice_start
        speech_peak = peak_db(voice[max(0,voice_offset):max(0,voice_offset+count)]) if voice is not None else None
        sync_pass = offset is not None and correlation >= .64 and abs(offset) <= 1000/fps
        clips.append({
            "id": cue["id"], "event": cue.get("event_id"), "planned_seconds": at,
            "decoded_offset_ms": offset, "waveform_correlation": correlation,
            "narration_peak_dbfs": speech_peak,
            "cue_sync_pass": sync_pass,
            "technical_pass": (False if not sync_pass or (speech_peak is not None and speech_peak > -38)
                               else None if voice_required and not voice_isolated else True),
        })
    integrated, peak = loudness(video)
    duration_ok = abs(len(mix)/SAMPLE_RATE-duration) <= 1/fps
    # The authorized reference-master route preserves its original mix/headroom.
    peak_limit = 0.0 if narration.get('preserve_reference_mix') else -1.0
    levels_pass = duration_ok and -31 <= integrated <= -9 and peak <= peak_limit
    cue_pass = all(cue["cue_sync_pass"] for cue in clips) if clips else None
    clearance_pass = (all(cue["narration_peak_dbfs"] <= -38 for cue in clips)
                      if clips and voice is not None else None)
    complete = bool(clips) and (not voice_required or voice_isolated)
    technical_pass = (False if not levels_pass or cue_pass is False or clearance_pass is False
                      else True if complete else None)
    return {"applicable": True, "direct_listening": False,
            "candidate_sha256":hashlib.sha256(video.read_bytes()).hexdigest(),
            "plan_sha256":hashlib.sha256(plan_path.read_bytes()).hexdigest(),
            "integrated_lufs": integrated,
            "true_peak_dbtp": peak, "duration_ok": duration_ok, "protected_cues": clips,
            "levels_pass": levels_pass, "true_peak_limit_dbtp": peak_limit,
            "protected_cue_count": len(clips),
            "cue_sync_status": "not_evaluated" if cue_pass is None else "passed" if cue_pass else "failed",
            "speech_clearance_status": ("not_applicable" if not voice_required else
                                        "not_evaluated" if clearance_pass is None else
                                        "passed" if clearance_pass else "failed"),
            "listening_status": "not_performed", "reference_match_status": "not_evaluated",
            "technical_coverage_complete": complete, "technical_pass": technical_pass}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--require-cue-sync", action="store_true",
                        help="Fail if protected-cue synchronization has not been tested and passed.")
    args = parser.parse_args()
    result = audit(args.plan, args.video)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(result, indent=2)+"\n")
    print(json.dumps(result, indent=2))
    if result["technical_pass"] is False:
        raise SystemExit(1)
    if args.require_cue_sync and result.get("cue_sync_status") != "passed":
        raise SystemExit(2)


if __name__ == "__main__":
    main()
