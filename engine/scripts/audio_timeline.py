#!/usr/bin/env python3
"""Mix the plan's narration and cues on the same absolute project timeline.

Require ffmpeg/ffprobe. Probe output is capped at five seconds. The report
records timing/levels/decode only and never claims listening or timbre match.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
from tempfile import TemporaryDirectory
from reference_audio_contract import validate_reference_master
from music_bus import music_cue


def run(cmd):
    return subprocess.run(cmd, check=True, capture_output=True, text=True)


def match_mix_level(file, target_lufs, peak_ceiling):
    stats = run(['ffmpeg', '-hide_banner', '-nostdin', '-i', str(file),
                 '-af', 'ebur128=peak=true', '-f', 'null', '-']).stderr.rsplit('Summary:', 1)[-1]
    integrated = re.search(r'I:\s*(-?[\d.]+) LUFS', stats)
    true_peak = re.search(r'Peak:\s*(-?[\d.]+) dBFS', stats)
    if not integrated or not true_peak:
        raise ValueError('Could not measure the mixed audio level.')
    gain_db = min(target_lufs - float(integrated[1]), peak_ceiling - float(true_peak[1]))
    if abs(gain_db) < .12:
        return 0.0
    with TemporaryDirectory(dir=file.parent) as temp:
        adjusted = Path(temp) / 'adjusted.wav'
        run(['ffmpeg', '-v', 'error', '-nostdin', '-i', str(file), '-af', f'volume={gain_db:.3f}dB',
             '-c:a', 'pcm_s16le', str(adjusted)])
        adjusted.replace(file)
    return round(gain_db, 3)


def gain_envelope(keys):
    amplitudes = [(time, 10 ** (db / 20)) for time, db in keys]
    ramps = [f'{amplitudes[0][1]:.8f}']
    for (start, a), (end, b) in zip(amplitudes, amplitudes[1:]):
        if a != b:
            ramps.append(f'({b-a:.8f})*clip((t-{start:.6f})/{end-start:.6f},0,1)')
    return f"volume='{'+'.join(ramps)}':eval=frame"


def reference_master(args, plan, base, assets):
    """Preserve a supplied full mix on its source clock; only encode for MP4 delivery."""
    narration = plan['audio']['narration']
    source, record, digest = validate_reference_master(plan, base, assets, args.start, args.seconds)
    meta = json.loads(run(['ffprobe','-v','error','-select_streams','a:0',
                          '-show_entries','stream=sample_rate,channels','-of','json',str(source)]).stdout)['streams'][0]
    rate, channels = int(meta['sample_rate']), int(meta['channels'])
    args.out.parent.mkdir(parents=True, exist_ok=True)
    mix_file = args.out.with_suffix('.mix.wav')
    # Decode/trim at sample precision. No loudnorm, gain, pan, EQ, or stem separation.
    run(['ffmpeg','-nostdin','-v','error','-y','-i',str(source),'-map','0:a:0',
         '-af',f'atrim=start={args.start}:end={args.start+args.seconds},asetpts=PTS-STARTPTS',
         '-c:a','pcm_f32le',str(mix_file)])
    mux = (['-i', str(mix_file), '-map', '0:a:0'] if args.audio_only else
           ['-i', str(args.picture), '-i', str(mix_file), '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy'])
    run(['ffmpeg','-nostdin','-v','error','-y',*mux,'-c:a','aac','-b:a','512k',
         '-ar',str(rate),'-ac',str(channels),'-t',str(args.seconds),
         '-movflags','+faststart',str(args.out)])
    run(['ffmpeg','-v','error','-xerror','-i',str(args.out),'-f','null','-'])
    report = {'video':str(args.out),'source_start':args.start,'seconds':args.seconds,
              'tracks':[{'id':'reference-master','asset_id':narration['asset_id'],
                         'source_start':args.start,'source_end':args.start+args.seconds,
                         'gain_db':0,'kind':'original_reference_full_mix'}],
              'asset_paths':{narration['asset_id']:str(source)},'decode_pass':True,
              'mix_wav':str(mix_file),'source_sha256':digest,'sample_rate':rate,'channels':channels,
              'reference_mix_reused':True,'normalization_applied':False,'level_adjustment_db':0,
              'audio_only':args.audio_only,'eligibility_contract_passed':True,
              'guide_is_not_a_timed_transcript':True,'original_components':'Voice, SFX and music preserved together in original full mix; stems not isolated.',
              'output_audio_encoding':'AAC-LC 512 kbps requested; source HE-AAC decoded once for exact trimming',
              'direct_listening':False,'reference_timbre_match_verified':False}
    args.out.with_suffix('.audio.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    return report


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--plan', type=Path, required=True)
    p.add_argument('--picture', type=Path)
    p.add_argument('--audio-only', action='store_true', help='Export M4A and PCM sidecar without rendering picture.')
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--start', type=float, default=0)
    p.add_argument('--seconds', type=float, required=True)
    p.add_argument('--probe', action='store_true')
    a = p.parse_args()
    if bool(a.picture) == bool(a.audio_only):
        p.error('Choose either --picture VIDEO or --audio-only.')
    if a.audio_only and a.out.suffix.lower() != '.m4a':
        p.error('Audio-only output must be an .m4a file.')
    if a.seconds <= 0 or (a.probe and a.seconds > 5.000001):
        p.error('Probe duration must be positive and no more than five seconds.')
    plan = json.loads(a.plan.read_text())
    base = a.plan.resolve().parent
    assets = {x['id']: x for x in plan['assets']}
    events = {x['id']: x['time'] for x in plan.get('events', [])}
    audio = plan['audio']
    if audio.get('mode') == 'narrated':
        n = audio.get('narration', {})
        asset = assets.get(n.get('asset_id'))
        if (audio.get('pending_user_narration') is True or n.get('required') is not True
                or asset is None or not (base / asset.get('path', '')).is_file()):
            raise ValueError('Supplied narration is missing or still pending. Import and align your recording, bind its audio asset and clear pending_user_narration; no TTS provider runs automatically.')
    if audio.get('narration', {}).get('preserve_reference_mix'):
        print(json.dumps(reference_master(a, plan, base, assets), ensure_ascii=False))
        return
    target_lufs = float(audio.get('mix_target_lufs', -16))
    # Keep headroom for AAC reconstruction of short panned transients.
    peak_ceiling = -2.3 if 'mix_target_lufs' in audio else -1
    if not -30 <= target_lufs <= -10:
        raise ValueError('Mix target must be between -30 and -10 LUFS.')
    music_track, music_report = music_cue(plan, base)
    tracks = []
    if audio.get('narration', {}).get('required'):
        n = audio['narration']
        tracks.append({'id': 'narration', 'asset_id': n['asset_id'], 'start': n.get('start', 0),
                       'end': plan['project']['duration_seconds'], 'gain_db': 0, 'kind': 'narration'})
    for cue in audio.get('cues', []):
        cue = dict(cue)
        if cue.get('event_id'):
            cue['start'] = events[cue['event_id']] + cue.get('offset', 0)
            cue['end'] = cue['start'] + cue['duration_seconds']
        tracks.append(cue)
    if music_track:
        tracks.append(music_track)
    stereo_mix = bool(music_track) or any(cue.get('stereo_pan') or cue.get('stereo_delay_ms') for cue in tracks)
    inputs = ['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-y']
    filters, labels, used, records = [], [], {}, []
    finish = a.start + a.seconds
    for cue in tracks:
        begin, end = float(cue['start']), float(cue['end'])
        lo, hi = max(begin, a.start), min(end, finish)
        if hi <= lo:
            continue
        asset = assets[cue['asset_id']]
        file = (base / asset['path']).resolve()
        if not file.is_file():
            raise ValueError(f'Missing requested audio asset: {file}')
        index = len(labels)
        if cue.get('loop'):
            inputs += ['-stream_loop', '-1']
        inputs += ['-i', str(file)]
        gain = float(cue.get('gain_db', -24 if cue.get('kind') == 'music' else -18))
        delay = round((lo - a.start) * 1000)
        tag = f'a{index}'
        pan = float(cue.get('stereo_pan', 0))
        spread = cue.get('stereo_delay_ms', 0)
        if not -1 <= pan <= 1 or type(spread) is not int or not 0 <= spread <= 25:
            raise ValueError(f'Invalid stereo placement for {cue["id"]}.')
        channel_filters = []
        if pan or spread:
            channel_filters += ['aformat=channel_layouts=mono',
                                f'pan=stereo|c0={1-pan:.4f}*c0|c1={1+pan:.4f}*c0']
            if spread:
                channel_filters.append(f'adelay=0|{spread}')
        elif stereo_mix:
            channel_filters.append('aformat=channel_layouts=stereo')
        gain_keys = cue.get('gain_keys')
        # Apply the cue's own clock before cutting the requested probe window.
        if gain_keys:
            channel_filters.append(gain_envelope(gain_keys))
        channel_filters += [f'atrim=start={lo-begin}:end={hi-begin}', 'asetpts=PTS-STARTPTS', 'aresample=48000']
        if not gain_keys:
            channel_filters.append(f'volume={gain}dB')
        channel_filters.append(f'adelay={delay}:all=1')
        filters.append(f'[{index}:a]{",".join(channel_filters)}[{tag}]')
        labels.append(f'[{tag}]')
        used[cue['asset_id']] = str(file)
        records.append({'id': cue['id'], 'source_start': begin, 'source_end': end,
                        'probe_start': lo-a.start, 'probe_end': hi-a.start, 'gain_db': gain,
                        'stereo_pan': pan, 'stereo_delay_ms': spread})
        if gain_keys:
            records[-1]['gain_keys'] = gain_keys
    if not labels:
        raise ValueError('No audible tracks overlap this range; label the output picture-only.')
    filters.append(''.join(labels) +
                   f'amix=inputs={len(labels)}:normalize=0:duration=longest,apad,atrim=duration={a.seconds},'
                   f'loudnorm=I={target_lufs}:TP={peak_ceiling}:LRA=11,aresample=48000[mix]')
    a.out.parent.mkdir(parents=True, exist_ok=True)
    mix_file = a.out.with_suffix('.mix.wav')
    inputs += ['-filter_complex', ';'.join(filters), '-map', '[mix]',
               '-c:a', 'pcm_s16le', '-ac', '2', '-t', str(a.seconds), str(mix_file)]
    run(inputs)
    level_adjustment = match_mix_level(mix_file, target_lufs, peak_ceiling) if 'mix_target_lufs' in audio and not a.probe else 0.0
    levels = run(['ffmpeg', '-hide_banner', '-i', str(mix_file), '-af',
                  'volumedetect', '-f', 'null', '-']).stderr
    match = re.search(r'max_volume: ([-\d.]+) dB', levels)
    if not match or float(match[1]) < -60:
        raise ValueError('The requested audio mix is effectively silent.')
    mux = (['-i', str(mix_file), '-map', '0:a:0'] if a.audio_only else
           ['-i', str(a.picture), '-i', str(mix_file), '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy'])
    run(['ffmpeg', '-nostdin', '-v', 'error', '-y', *mux,
         '-c:a', 'aac', '-b:a', '160k', '-t', str(a.seconds),
         '-movflags', '+faststart', str(a.out)])
    run(['ffmpeg', '-v', 'error', '-xerror', '-i', str(a.out), '-f', 'null', '-'])
    report = {'video': str(a.out), 'source_start': a.start, 'seconds': a.seconds,
              'tracks': records, 'asset_paths': used, 'decode_pass': True,
              'mix_wav': str(mix_file), 'mix_peak_dbfs': float(match[1]),
              'mix_target_lufs': target_lufs, 'mix_true_peak_ceiling_dbfs': peak_ceiling,
              'level_adjustment_db': level_adjustment,
              'audio_only': a.audio_only,
              'music_bus': music_report,
              'direct_listening': False, 'reference_timbre_match_verified': False}
    a.out.with_suffix('.audio.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, subprocess.CalledProcessError) as exc:
        raise SystemExit(f'Audio timeline failed: {exc}')
