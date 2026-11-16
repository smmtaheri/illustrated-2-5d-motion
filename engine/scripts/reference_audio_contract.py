#!/usr/bin/env python3
"""Validate eligibility to preserve a supplied full mix; this is not listening."""
import hashlib
import json
from pathlib import Path


def guide_digest(plan):
    guide = [{k: beat.get(k) for k in ('id', 'narration', 'narration_language')}
             for beat in plan.get('beats', [])]
    return hashlib.sha256(json.dumps(guide, sort_keys=True, ensure_ascii=False,
                                    separators=(',', ':')).encode()).hexdigest()


def validate_reference_master(plan, base, assets, start, seconds):
    audio = plan['audio']
    n = audio['narration']
    if not n.get('required') or not n.get('preserve_reference_mix') or audio.get('cues'):
        raise ValueError('A preserved full mix requires one unchanged master and no added cues.')
    if n.get('isolated_stem') is not False:
        raise ValueError('The reference full mix is not an isolated narration stem.')
    for key, wanted in [('start', 0), ('gain_db', 0), ('offset', 0), ('playback_rate', 1)]:
        if n.get(key, wanted) != wanted:
            raise ValueError('Reference master cannot change start, gain, offset or playback rate.')
    if n.get('gain_keys'):
        raise ValueError('Reference master cannot have a gain envelope.')
    source = (Path(base)/assets[n['asset_id']]['path']).resolve()
    record = json.loads((Path(base)/n['source_record_path']).read_text())
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    if digest != n.get('source_sha256') or digest != record.get('audio_asset_sha256'):
        raise ValueError('Reference master hash changed; revalidate the replacement.')
    language = record.get('narration_language')
    requested = plan['project'].get('language', {}).get('resolved', {}).get('narration')
    if not language or n.get('language') != language or requested != language:
        raise ValueError('Changed narration language requires an authored mix, not the original master.')
    if guide_digest(plan) != record.get('guide_binding_sha256'):
        raise ValueError('Changed narration guide requires an authored mix or explicit source revalidation.')
    if abs(float(audio.get('mix_target_lufs', record['integrated_lufs']))-record['integrated_lufs']) > .1:
        raise ValueError('Changed loudness requires an authored mix; master preservation does not normalize.')
    if audio.get('music') != 'included_in_reference_master':
        raise ValueError('Changed music requires an authored mix or separate licensed stems.')
    duration = float(record['source_video_seconds'])
    if abs(plan['project']['duration_seconds']-duration) > 1e-6:
        raise ValueError('Changed picture duration requires a new audio timeline.')
    if start < 0 or seconds <= 0 or start+seconds > duration+1e-6:
        raise ValueError('Reference master interval exceeds its unchanged source clock.')
    return source, record, digest
