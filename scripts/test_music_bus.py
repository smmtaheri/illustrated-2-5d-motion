#!/usr/bin/env python3
"""Bounded local signal/mux regression. Synthetic fixtures are not listening."""
from array import array
from copy import deepcopy
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile
import wave

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine/scripts"))
from music_bus import music_cue, validate_music


def run(command):
    return subprocess.run(command, check=True, capture_output=True, text=True)


def write_tone(path, frequency, active, seconds=4, amplitude=.15):
    rate = 16000
    samples = array("h", (round(amplitude*32767*math.sin(2*math.pi*frequency*i/rate))
                          if any(a <= i/rate < b for a, b in active) else 0 for i in range(seconds*rate)))
    if sys.byteorder != "little":
        samples.byteswap()
    with wave.open(str(path), "wb") as f:
        f.setnchannels(1); f.setsampwidth(2); f.setframerate(rate); f.writeframes(samples.tobytes())


def decode(path):
    raw = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", str(path), "-ac", "1",
                          "-ar", "16000", "-f", "f32le", "-"], check=True, capture_output=True).stdout
    values = array("f"); values.frombytes(raw)
    if sys.byteorder != "little":
        values.byteswap()
    return values


def amplitude(values, start, end, frequency):
    first, last = round(start*16000), round(end*16000)
    signal = values[first:last]
    a = sum(x*math.sin(2*math.pi*frequency*(i+first)/16000) for i, x in enumerate(signal))
    b = sum(x*math.cos(2*math.pi*frequency*(i+first)/16000) for i, x in enumerate(signal))
    return 2*math.sqrt(a*a+b*b)/len(signal)


def main():
    # Explicitly use the portable mixer or a supplied adapted disposable one.
    mixer = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "engine/scripts/audio_timeline.py"
    with tempfile.TemporaryDirectory(prefix="music-bus-test-") as temp:
        folder = Path(temp)
        write_tone(folder/"voice.wav", 440, [(.25, 1.25), (2.25, 3.25)])
        write_tone(folder/"music.wav", 180, [(0, 4)])
        write_tone(folder/"click.wav", 1400, [(0, .10)], seconds=1)
        plan = {"project": {"duration_seconds": 4, "fps": 30},
                "assets": [{"id": n, "kind": "audio", "path": n+".wav"} for n in ("voice", "music", "click")],
                "events": [{"id": "clicked", "time": 1.75}],
                "audio": {"mode": "narrated", "mix_target_lufs": -16.5,
                          "narration": {"required": True, "asset_id": "voice"},
                          "music": {"asset_id": "music", "gain_db": -12, "fade_in_seconds": .1,
                                    "fade_out_seconds": .2, "ducking": {"reduction_db": 7}},
                          "cues": [{"id": "click", "kind": "sfx", "asset_id": "click", "start": 1.75,
                                    "end": 1.85, "duration_seconds": .1, "event_id": "clicked",
                                    "foreground": True, "gain_db": 0}]}}
        original = deepcopy(plan)
        cue, report = music_cue(plan, folder)
        assert plan == original, "Music analysis mutated another bus"
        assert report["narration_modified"] is False and report["other_cues_modified"] is False
        assert report["speech_intervals"] == [[.24, 1.26], [2.24, 3.26]], report["speech_intervals"]
        assert cue["gain_keys"][0][0] == 0 and cue["gain_keys"][-1][0] == 4
        def gain_at(keys, time):
            for (start, a), (end, b) in zip(keys, keys[1:]):
                if start <= time <= end:
                    return a + (b-a)*(time-start)/(end-start)
            raise AssertionError("Gain time outside cue")
        assert abs(gain_at(cue["gain_keys"], 1.8) - (-15)) < .02, "Foreground event did not lower music"
        quiet_plan = deepcopy(plan)
        quiet_plan["audio"]["music"]["quiet_intervals"] = [[1.55, 1.65]]
        quiet_cue, _ = music_cue(quiet_plan, folder)
        assert gain_at(quiet_cue["gain_keys"], 1.6) <= -90, "Requested quiet interval is not silent"
        for invalid in ({"asset_id": "music", "duck_under_narration": True},
                        {"asset_id": "music", "ducking": {"attack_seconds": float("nan")}},
                        {"asset_id": "music", "quiet_intervals": [[3, 2]]}):
            try:
                validate_music(invalid, 4)
            except ValueError:
                pass
            else:
                raise AssertionError("Invalid config was silently accepted")
        spec = folder/"plan.json"; spec.write_text(json.dumps(plan))
        run([sys.executable, str(mixer.resolve()), "--plan", str(spec), "--audio-only", "--out", str(folder/"probe.m4a"),
             "--seconds", "4", "--probe"])
        decoded = decode(folder/"probe.mix.wav")
        under = amplitude(decoded, .6, 1, 180)
        gap = amplitude(decoded, 1.58, 1.68, 180)
        reduction = 20*math.log10(gap/under)
        assert 6.3 <= reduction <= 7.7, reduction
        # The foreground cue remains on the exact source clock and is neither
        # shifted nor voice-ducked. Compare distinct spectral lines after mix.
        voice = amplitude(decoded, .6, 1, 440)
        click = amplitude(decoded, 1.77, 1.83, 1400)
        assert abs(20*math.log10(click/voice)) < .8, (click, voice)
        assert abs(len(decoded)/16000-4) < .001
        mixed_report = json.loads((folder/"probe.audio.json").read_text())
        assert mixed_report["music_bus"]["listening_performed"] is False
        # Probe cropping retains the absolute music/narration clock.
        run([sys.executable, str(mixer.resolve()), "--plan", str(spec), "--audio-only", "--out", str(folder/"crop.m4a"),
             "--start", "1.5", "--seconds", "1", "--probe"])
        cropped = json.loads((folder/"crop.audio.json").read_text())
        assert cropped["music_bus"]["gain_keys"] == mixed_report["music_bus"]["gain_keys"]
        assert [t for t in cropped["tracks"] if t["id"] == "click"][0]["probe_start"] == .25
        print(json.dumps({"status": "pass", "seconds_per_fixture": 4,
                          "music_reduction_measured_db": round(reduction, 3),
                          "click_to_voice_level_difference_db": round(20*math.log10(click/voice), 3),
                          "checks": ["only music bus attenuated", "7dB speech reduction measured after real FFmpeg mix",
                                     "foreground cue level and clock preserved", "end time exact", "probe absolute-clock envelope",
                                     "invalid config rejected", "no plan mutation"],
                          "scope": "Synthetic technical signals, not speech quality or listening approval."}, indent=2))


if __name__ == "__main__":
    main()
