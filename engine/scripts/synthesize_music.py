#!/usr/bin/env python3
"""Author a deterministic, seamless 24-second soft mallet/pad music loop locally.

Original note sequence and additive instruments; no reference extraction, model,
downloaded performance or external sample. This is a candidate for listening.
"""
from array import array
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
import wave


def synthesize(destination):
    rate, seconds = 32000, 24
    count = rate*seconds
    left, right = array("d", [0])*count, array("d", [0])*count
    tau = 2*math.pi

    def note(at, midi, length, level, pan, pad=False):
        frequency = 440 * 2 ** ((midi-69)/12)
        first = round(at*rate)
        lg, rg = math.sqrt((1-pan)/2), math.sqrt((1+pan)/2)
        for i in range(round(length*rate)):
            t = i/rate
            if pad:
                envelope = min(1, t/.9, (length-t)/1.5)
                envelope = max(0, envelope)**1.6
                signal = (.78*math.sin(tau*frequency*t) + .16*math.sin(tau*frequency*2*t)
                          + .06*math.sin(tau*frequency*3*t)) * envelope
            else:
                envelope = (1-math.exp(-t/.025))*math.exp(-t/1.0)*min(1, (length-t)/.4)
                signal = (math.sin(tau*frequency*t) + .20*math.sin(tau*frequency*2*t)*math.exp(-t/.4)
                          + .08*math.sin(tau*frequency*3*t)*math.exp(-t/.16)) * envelope
            index = (first+i) % count
            left[index] += level*signal*lg
            right[index] += level*signal*rg

    # Eight bars, 80 BPM: open Dmaj7 -> Bm7 -> Gmaj7 -> Asus2. Sparse
    # five-note motif leaves room for speech and repeats with small variation.
    chords = ((50, 57, 61, 66), (47, 54, 57, 62), (43, 50, 54, 59), (45, 52, 57, 59))
    for bar in range(8):
        for i, pitch in enumerate(chords[(bar//2) % 4]):
            note(bar*3, pitch, 4.7, .11 if i == 0 else .07, (-.45, .35, -.2, .5)[i], pad=True)
    motif = ((.5, 74), (2.0, 76), (4.25, 81), (6.75, 78), (9.25, 76),
             (12.5, 74), (14.0, 76), (16.25, 81), (18.75, 78), (21.25, 73))
    for i, (time, pitch) in enumerate(motif):
        note(time, pitch, 2.8, .15, .18 if i % 2 else -.18)
        note(time+.23, pitch, 2.6, .025, -.4 if i % 2 else .4)
    peak = max(max(abs(x) for x in left), max(abs(x) for x in right))
    scale = (10 ** (-8/20))/peak
    samples = array("h")
    for a, b in zip(left, right):
        samples.extend((round(a*scale*32767), round(b*scale*32767)))
    if sys.byteorder != "little":
        samples.byteswap()
    destination.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(destination), "wb") as output:
        output.setnchannels(2); output.setsampwidth(2); output.setframerate(rate)
        output.writeframes(samples.tobytes())
    return {"path": str(destination), "sha256": hashlib.sha256(destination.read_bytes()).hexdigest(),
            "sample_rate": rate, "channels": 2, "seconds": seconds, "peak_dbfs": -8,
            "tempo_bpm": 80, "loopable": True, "seam_method": "cyclic accumulation of complete note tails",
            "instruments": "original additive soft mallet and sustained sine pad; no percussion/vocals",
            "listening_performed": False, "perceptual_approval": False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    if args.out.exists():
        parser.error("Refusing to overwrite an existing music asset; choose a new version.")
    print(json.dumps(synthesize(args.out), indent=2))
