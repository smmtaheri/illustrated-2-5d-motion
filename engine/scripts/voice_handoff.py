"""Export human-recording copy independently of rendered sound directions."""
import json


def write_voice_handoff(recipe, plan, out):
    fps=plan['project']['fps']; rows=[]
    for beat in plan['beats']:
        authored=recipe.get('beats',{}).get(beat['id'],{})
        shot=next(s for s in recipe['shots'] if s.get('beat',s['id'])==beat['id'])
        text=authored.get('voice',shot.get('voice',''))
        if not text.strip(): raise ValueError('Missing human voice text: '+beat['id'])
        window=authored.get('speech_window_frames',[3,round((beat['end']-beat['start'])*fps)-4])
        rows.append({'id':beat['id'],'picture_start':beat['start'],'picture_end':beat['end'],
                     'target_voice_start':beat['start']+window[0]/fps,
                     'target_voice_end':beat['start']+window[1]/fps,
                     'text':text,'directed_text':authored.get('voice_directed',text),
                     'delivery':authored.get('delivery','Warm, clear conversational explanation; no theatrical shout.'),
                     'pauses_ms':authored.get('pauses_ms',[])})
    doc={'language':plan['project']['language']['resolved']['narration'],'status':'awaiting_user_voice',
         'timings':'Targets only. Measure supplied takes; never claim spoken timing before recording or truncate words.',
         'recording':'Use one complete clean voice file unless the current brief explicitly requests separate takes. Read spoken text only; direction tags, cue names and timecodes are not speech. Align measured phrases and pauses after receiving actual audio.',
         'input_layout':recipe.get('audio',{}).get('input_layout','single_file'),
         'beats':rows,'sound_cues':plan['audio']['cues']}
    (out/'voice-handoff.json').write_text(json.dumps(doc,ensure_ascii=False,indent=2)+'\n')
    (out/'voice-clean.txt').write_text('\n'.join(r['text'] for r in rows)+'\n')
    (out/'voice-directed.txt').write_text('\n'.join(r['directed_text'] for r in rows)+'\n')
