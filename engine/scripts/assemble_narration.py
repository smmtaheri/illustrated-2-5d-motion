#!/usr/bin/env python3
"""Place real per-beat speech takes without cutting words or extending the plan.

Takes JSON maps beat IDs to {file, word_timings?}, relative to the takes file.
Edge TTS WordBoundary offsets are accepted; Unicode words are preserved.
Require numpy, ffmpeg, ffprobe. Listening remains a separate review.
"""
import argparse
import json
from pathlib import Path
import subprocess
import unicodedata
import wave
import numpy as np


def normalized(text):
    return ''.join(c for c in unicodedata.normalize('NFC', text).casefold()
                   if unicodedata.category(c)[0] in 'LMN')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--plan', type=Path, required=True)
    p.add_argument('--takes', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    a = p.parse_args()
    plan, takes = json.loads(a.plan.read_text()), json.loads(a.takes.read_text())
    rate = 48000
    track = np.zeros(round(plan['project']['duration_seconds']*rate), dtype=np.float64)
    events, records = [], []
    for beat in plan['beats']:
        if not beat.get('narration'):
            continue
        take = takes[beat['id']]
        file = (a.takes.resolve().parent/take['file']).resolve()
        result = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(file), '-ar', str(rate),
                                 '-ac', '1', '-f', 'f32le', '-'], check=True, capture_output=True)
        pcm = np.frombuffer(result.stdout, dtype='<f4').astype(np.float64)
        lead, tail = beat.get('narration_window', [beat['start'], beat['end']])
        if not beat['start'] <= lead < tail <= beat['end'] + 1e-8:
            raise ValueError(f"{beat['id']}: narration window lies outside its beat.")
        duration, budget = len(pcm)/rate, tail-lead
        if duration > budget-.04:
            raise ValueError(f"{beat['id']}: speech {duration:.3f}s exceeds {budget:.3f}s beat; regenerate, never truncate words.")
        start = round((lead+.02)*rate)
        track[start:start+len(pcm)] += pcm
        records.append({'beat_id': beat['id'], 'start': lead+.02,
                        'speech_end': lead+.02+duration, 'beat_end': beat['end']})
        if take.get('word_timings'):
            word_file = (a.takes.resolve().parent/take['word_timings']).resolve()
            words = [json.loads(line) for line in word_file.read_text().splitlines() if line.strip()]
            heard = []
            for i, word in enumerate(words):
                if word.get('type') != 'WordBoundary':
                    continue
                text = word.get('text', '')
                heard.append(normalized(text))
                events.append({'id': f"{beat['id']}.word.{i}", 'text': text,
                               'time': lead+.02+word['offset']/10000000,
                               'duration_seconds': word['duration']/10000000,
                               'timing_source': 'provider WordBoundary; not direct listening'})
            expected = [normalized(w) for w in beat['narration'].split() if normalized(w)]
            actual = [w for w in heard if w]
            if expected != actual:
                raise ValueError(f"{beat['id']}: provider word metadata differs from the requested script: {actual}")
    peak = np.max(np.abs(track))
    if peak > .89:
        track *= .89/peak
    a.out.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(a.out), 'wb') as f:
        f.setnchannels(1); f.setsampwidth(2); f.setframerate(rate)
        f.writeframes(np.round(np.clip(track, -1, 1)*32767).astype('<i2').tobytes())
    report = {'beats': records, 'word_events': events, 'unicode_word_validation': True,
              'direct_listening': False, 'script_pronunciation_verified': False,
              'duration_seconds': len(track)/rate}
    a.out.with_suffix('.timing.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps({'out': str(a.out), 'beats': len(records), 'word_events': len(events), 'direct_listening': False}))


if __name__ == '__main__':
    try:
        main()
    except (KeyError, ValueError, OSError, subprocess.CalledProcessError) as exc:
        raise SystemExit(f'Narration assembly failed: {exc}')
