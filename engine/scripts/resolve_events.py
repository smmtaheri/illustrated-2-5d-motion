#!/usr/bin/env python3
"""Resolve shared motion/SFX events from real narration word timestamps.

Use --plan source.json --timings voice.timing.json --out plan.json.
Events may have an absolute time or a word_id plus offset. Event-linked sound
cues receive derived start/end values for the plan checker and renderer.
"""
import argparse
import json
import math
from pathlib import Path


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--plan', type=Path, required=True)
    p.add_argument('--timings', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    a = p.parse_args()
    plan = json.loads(a.plan.read_text())
    timings = json.loads(a.timings.read_text())
    words = {w['id']: w for w in timings['word_events']}
    events = {}
    duration = plan['project']['duration_seconds']
    for event in plan.get('events', []):
        event_id = event['id']
        if event_id in events:
            raise ValueError(f'Duplicate event {event_id}')
        if event.get('word_id'):
            word = words[event['word_id']]
            edge = event.get('word_edge', 'start')
            if edge not in {'start', 'end'}:
                raise ValueError(f'Event {event_id} has an invalid word_edge')
            event['time'] = word['time'] + (word['duration_seconds'] if edge == 'end' else 0) + event.get('offset', 0)
            event['timing_source'] = 'provider word boundary plus explicit offset; not direct listening'
        time = event['time']
        if not isinstance(time, (int, float)) or not math.isfinite(time) or not 0 <= time < duration:
            raise ValueError(f'Event {event_id} is outside the project')
        events[event_id] = time
    for cue in plan.get('audio', {}).get('cues', []):
        if not cue.get('event_id'):
            continue
        cue['start'] = events[cue['event_id']] + cue.get('offset', 0)
        cue['end'] = cue['start'] + cue['duration_seconds']
        if cue['start'] < 0 or cue['end'] > duration:
            raise ValueError(f"Cue {cue['id']} is outside the project")
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(plan, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps({'out': str(a.out), 'events': len(events),
                      'source': 'real provider word timing; listening unverified'}))


if __name__ == '__main__':
    try:
        main()
    except (KeyError, ValueError, OSError) as exc:
        raise SystemExit(f'Event resolution failed: {exc}')
