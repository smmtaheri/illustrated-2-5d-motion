#!/usr/bin/env python3
"""Rebuild the skill's original, deterministic PCM sound palette.

Use only Python's standard library. Write audio/*.wav and sound-palette.json
inside the requested output directory. These are authored production sounds,
not recovered reference recordings, narration, or a complete soundtrack.
"""

import argparse
import array
import json
import math
from pathlib import Path
import random
import sys
import wave

RATE = 48000
SEED = 2601106


def filtered_noise(count, seed, smoothing, remove_low):
    rng = random.Random(seed)
    low, slow = 0.0, 0.0
    result = []
    for _ in range(count):
        low += smoothing * (rng.uniform(-1.0, 1.0) - low)
        slow += remove_low * (low - slow)
        result.append(low - slow)
    return result


def looped_noise(seconds, seed, smoothing, remove_low):
    count = round(seconds * RATE)
    overlap = round(0.12 * RATE)
    warmup = round(0.25 * RATE)
    raw = filtered_noise(count + overlap + warmup, seed, smoothing, remove_low)[warmup:]
    # Continue the tail into the first crossfade, then arrive at the head.
    # The final -> first sample thus follows the same filtered noise stream.
    result = raw[:count]
    for i in range(overlap):
        progress = i / (overlap - 1)
        blend = 0.5 - 0.5 * math.cos(math.pi * progress)
        result[i] = raw[count + i] * (1.0 - blend) + raw[i] * blend
    return result


def sweep():
    seconds = 0.28
    raw = filtered_noise(round(seconds * RATE), SEED + 1, 0.19, 0.012)
    return [value * math.sin(math.pi * i / (len(raw) - 1)) ** 1.8
            for i, value in enumerate(raw)]


def tick():
    count = round(0.09 * RATE)
    raw = filtered_noise(count, SEED + 2, 0.4, 0.01)
    result = []
    for i, noise in enumerate(raw):
        t = i / RATE
        attack = min(1.0, t / 0.003)
        tail = min(1.0, (count - 1 - i) / (0.01 * RATE))
        envelope = attack * max(0.0, tail) * math.exp(-t / 0.017)
        result.append(envelope * (0.8 * math.sin(2 * math.pi * 920 * t) + 0.2 * noise))
    return result


def resolve():
    count = round(0.48 * RATE)
    result = []
    for i in range(count):
        t = i / RATE
        attack = min(1.0, t / 0.018)
        tail = min(1.0, (count - 1 - i) / (0.07 * RATE))
        envelope = attack * max(0.0, tail) * math.exp(-t / 0.14)
        tone = math.sin(2 * math.pi * 660 * t) + 0.26 * math.sin(2 * math.pi * 990 * t)
        result.append(envelope * tone)
    return result


def write_wav(path, samples, peak_dbfs):
    peak = max(abs(x) for x in samples) or 1.0
    scale = 10 ** (peak_dbfs / 20) / peak
    pcm = array.array("h", (max(-32767, min(32767, round(x * scale * 32767))) for x in samples))
    measured_peak = max(abs(x) for x in pcm) / 32768
    rms = math.sqrt(sum((x / 32768) ** 2 for x in pcm) / len(pcm))
    if sys.byteorder != "little":
        pcm.byteswap()
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(RATE)
        output.writeframes(pcm.tobytes())
    return {
        "frames": len(samples), "duration_seconds": len(samples) / RATE,
        "peak_dbfs": round(20 * math.log10(measured_peak), 3),
        "rms_dbfs": round(20 * math.log10(rms), 3),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    destination = args.out.resolve()
    audio_dir = destination / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)
    cues = [
        ("air-sweep.wav", sweep(), -19, False, "soft filtered-air swell for a meaningful reveal"),
        ("soft-tick.wav", tick(), -20, False, "muted marker for a discrete event"),
        ("soft-resolve.wav", resolve(), -22, False, "restrained tone for one explanatory resolution"),
        ("air-bed-loop.wav", looped_noise(4.0, SEED + 3, 0.10, 0.006), -25, True, "quiet diffuse atmospheric air"),
        ("distant-rain-loop.wav", looped_noise(4.0, SEED + 4, 0.56, 0.07), -25, True, "soft rainfall aloft without surface impacts"),
    ]
    manifest = {"version": 1, "provenance": "original synthetic house palette; not source soundtrack extraction",
                "generator": "scripts/synthesize_sfx.py", "seed": SEED,
                "sample_rate": RATE, "channels": 1, "format": "PCM 16-bit little-endian WAV",
                "normalization_is_not_mix_gain": True, "cues": []}
    for name, samples, peak_dbfs, looping, role in cues:
        measurement = write_wav(audio_dir / name, samples, peak_dbfs)
        manifest["cues"].append({"file": "audio/" + name, "loopable": looping, "role": role,
                                  "normalization_peak_dbfs": peak_dbfs, **measurement})
    (destination / "sound-palette.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"cues": len(cues), "sample_rate": RATE,
                      "manifest": str(destination / "sound-palette.json")}, indent=2))


if __name__ == "__main__":
    main()
