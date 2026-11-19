#!/usr/bin/env node
'use strict';

const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn,spawnSync}=require('node:child_process'),{once}=require('node:events');
// Compiled projects may live outside this skill. Their copied scene modules
// resolve the same pinned Canvas dependency installed at the skill root.
const dependencyRoot=path.resolve(__dirname,'../../node_modules');
if(fs.existsSync(path.join(dependencyRoot,'@napi-rs/canvas'))){
 const previous=process.env.NODE_PATH?process.env.NODE_PATH.split(path.delimiter):[];
 process.env.NODE_PATH=[dependencyRoot,...previous.filter(p=>p!==dependencyRoot)].join(path.delimiter);
 require('node:module').Module._initPaths();
}
const {createCanvas,loadImage}=require('@napi-rs/canvas');
const {createProject}=require('./scene_runtime.cjs');
function args(argv){
 const out={start:0};const pairs={'--plan':'plan','--out':'out','--width':'width','--start':'start','--seconds':'seconds'};
 for(let i=0;i<argv.length;i++){
  const k=argv[i];if(['--probe','--final','--storyboard-only','--picture-only','--camera-locked','--hide-headings','--help'].includes(k)){out[k.slice(2)]=true;continue;}
  if(!pairs[k]||!argv[i+1])throw new Error(`Unknown/incomplete argument ${k}`);out[pairs[k]]=argv[++i];
 }
 for(const k of ['width','start','seconds'])if(out[k]!==undefined)out[k]=Number(out[k]);return out;
}
const sha=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
async function sheet(project,picks,file,renderOptions){
 const tileW=270,tileH=Math.round(tileW*project.height/project.width),cols=Math.min(4,picks.length),cap=38;
 const canvas=createCanvas(cols*tileW,Math.ceil(picks.length/cols)*(tileH+cap)),ctx=canvas.getContext('2d');ctx.fillStyle='#15263e';ctx.fillRect(0,0,canvas.width,canvas.height);
 const evidence=[];
 for(let i=0;i<picks.length;i++){
  const p=picks[i],frame=Math.min(project.totalFrames-1,Math.max(0,Math.round(p.time*project.fps))),png=project.renderFrame(frame,renderOptions).toBuffer('image/png');
  const pngName=`${String(i).padStart(2,'0')}-f${String(frame).padStart(4,'0')}.png`;fs.writeFileSync(path.join(path.dirname(file),'frames',pngName),png);
  const immutable=await loadImage(png),x=i%cols*tileW,y=Math.floor(i/cols)*(tileH+cap);ctx.drawImage(immutable,x,y,tileW,tileH);ctx.font='12px "Reel Reference Sans"';ctx.fillStyle='#f6f5ec';ctx.fillText(`${p.shot} | f${frame} | ${(frame/project.fps).toFixed(3)}s`,x+7,y+tileH+23);
  evidence.push({...p,frame,time:frame/project.fps,file:`frames/${pngName}`,sha256:sha(png)});
 }
 fs.writeFileSync(file,canvas.toBuffer('image/jpeg',92));return evidence;
}
async function main(){
 const opt=args(process.argv.slice(2));if(opt.help){console.log('render_project.cjs --plan PLAN.json --out ABS_DIR [--probe --start 0 --seconds 3] [--storyboard-only] [--width 540] [--picture-only] [--camera-locked] [--hide-headings]\nOne scene evaluator supplies stills, storyboard and animation. Probes are capped at 5 seconds and 3 shots. Use --hide-headings for internal scenario previews and --final for a requested full deliverable.');return;}
 if(!opt.plan||!opt.out||!path.isAbsolute(opt.out))throw new Error('Supply --plan and absolute --out.');
 if(!opt['storyboard-only']&&!opt.probe&&!opt.final)throw new Error('Choose --probe or explicit --final; no implicit long render.');
 if(opt.final&&opt['camera-locked'])throw new Error('Use camera-locked inspection on a probe or storyboard.');
 if(opt.final&&opt['hide-headings'])throw new Error('Use --hide-headings on a probe or storyboard.');
 const authoredPlan=JSON.parse(fs.readFileSync(path.resolve(opt.plan),'utf8'));
 if(!opt['picture-only']&&!opt['storyboard-only']&&authoredPlan.audio?.pending_user_narration===true)throw new Error('Supplied narration is still pending. Bind the real recording before audio output; use --picture-only for a visual probe.');
 if(!opt['picture-only']&&!opt['storyboard-only']&&authoredPlan.audio?.mode==='narrated'){
  const narration=authoredPlan.audio.narration||{},asset=authoredPlan.assets.find(a=>a.id===narration.asset_id);
  if(authoredPlan.audio.pending_user_narration===true||narration.required!==true||!asset||!fs.existsSync(path.resolve(path.dirname(opt.plan),asset.path)))throw new Error('Supplied narration is missing or pending. Import and align your recording, bind its audio asset and clear pending_user_narration. No TTS provider runs automatically; use --picture-only for a visual probe.');
 }
 const renderOptions={lockedCamera:!!opt['camera-locked'],hideHeadings:!!opt['hide-headings']};
 const lint=spawnSync('python3',[path.join(__dirname,'check_project.py'),path.resolve(opt.plan),'--mode','final','--json'],{encoding:'utf8'});
 if(lint.status!==0)throw new Error(`Plan lint failed: ${lint.stdout||lint.stderr}`);
 const project=await createProject(path.resolve(opt.plan),{width:opt.width??(opt.final?undefined:540)}),start=opt.start,seconds=opt.seconds??project.duration-start;
 if(!Number.isFinite(start)||!Number.isFinite(seconds)||start<0||seconds<=0||start+seconds>project.duration+1e-6)throw new Error('Invalid project range.');
 const visible=project.plan.shots.filter(s=>s.start<start+seconds&&s.end>start);
 if(opt.probe&&(seconds>5+1e-8||visible.length>3))throw new Error('Probe budget: at most 5 seconds and 3 shots.');
 const out=path.resolve(opt.out);fs.mkdirSync(path.join(out,'frames'),{recursive:true});
 const picks=visible.flatMap(s=>{const a=Math.max(s.start,start),b=Math.min(s.end,start+seconds);return[{shot:s.id,phase:'first',time:a},{shot:s.id,phase:'middle',time:(a+b)/2},{shot:s.id,phase:'result',time:Math.max(a,b-1/project.fps)}];});
 const samples=await sheet(project,picks,path.join(out,'storyboard.jpg'),renderOptions);
 const startFrame=Math.round(start*project.fps),count=Math.round(seconds*project.fps),video=path.join(out,'picture.mp4');
 if(!opt['storyboard-only']){
  const ff=spawn('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-y','-f','rawvideo','-pixel_format','rgba','-video_size',`${project.width}x${project.height}`,'-framerate',String(project.fps),'-i','pipe:0','-an','-c:v','libx264','-preset','veryfast','-crf','17','-pix_fmt','yuv420p','-movflags','+faststart',video],{stdio:['pipe','ignore','pipe']});
  let errors='',pipeError;ff.stderr.on('data',d=>errors+=d);ff.stdin.on('error',e=>pipeError=e);const closed=once(ff,'close');
  for(let n=0;n<count;n++){if(pipeError)throw pipeError;const data=project.renderFrame(startFrame+n,renderOptions).data();if(!ff.stdin.write(data))await once(ff.stdin,'drain');}
  ff.stdin.end();const [code]=await closed;if(code)throw new Error(`Encoder failed: ${errors}`);
  const decode=spawnSync('ffmpeg',['-v','error','-xerror','-i',video,'-f','null','-'],{encoding:'utf8'});if(decode.status)throw new Error(decode.stderr);
 }
 // Byte-identical decoded scene snapshots are required when frame evaluation
 // order changes. The storyboard and animation call the same function.
 const testFrames=[startFrame,startFrame+Math.floor(count/2),startFrame+count-1],first=new Map(testFrames.map(f=>[f,sha(project.renderFrame(f,renderOptions).toBuffer('image/png'))]));
 for(const f of [...testFrames].reverse())if(sha(project.renderFrame(f,renderOptions).toBuffer('image/png'))!==first.get(f))throw new Error(`Order-dependent frame ${f}`);
 const inventory={asset_ids:[...project.consumed.keys()],asset_paths:Object.fromEntries(project.consumed),shot_ids:visible.map(s=>s.id),width:project.width,height:project.height,fps:project.fps,duration_seconds:seconds,source_start_seconds:start,frames:count,plan_sha256:sha(fs.readFileSync(opt.plan)),engine_sha256:sha(fs.readFileSync(path.join(__dirname,'scene_runtime.cjs'))),runtime:{node:process.version,canvas:require('@napi-rs/canvas/package.json').version},same_evaluator_for_storyboard_and_video:true,frame_order_independent:true,storyboard:samples,video_rendered:!opt['storyboard-only'],picture_only:!!opt['picture-only']||project.plan.audio?.mode!=='narrated',perceptual_approval:false};
 inventory.font_registry=project.fontRegistry();
 inventory.camera_locked=renderOptions.lockedCamera;
 if(renderOptions.hideHeadings)inventory.headings_hidden=true;
 fs.writeFileSync(path.join(out,'render-manifest.json'),JSON.stringify(inventory,null,2)+'\n');
 if(!opt['storyboard-only']&&!opt['picture-only']&&(project.plan.audio?.mode==='narrated'||project.plan.audio?.cues?.length||project.plan.audio?.music)){
  const mix=spawnSync('python3',[path.join(__dirname,'audio_timeline.py'),'--plan',path.resolve(opt.plan),'--picture',video,'--out',path.join(out,'final.mp4'),'--start',String(start),'--seconds',String(seconds),...(opt.probe?['--probe']:[])],{encoding:'utf8'});
  if(mix.status!==0)throw new Error(`Narration mix failed; picture is only a preview: ${mix.stderr||mix.stdout}`);
  const audio=JSON.parse(mix.stdout.trim().split('\n').at(-1));Object.assign(inventory.asset_paths,audio.asset_paths);inventory.asset_ids=Object.keys(inventory.asset_paths);inventory.picture_only=false;inventory.audio_report='final.audio.json';
  fs.writeFileSync(path.join(out,'render-manifest.json'),JSON.stringify(inventory,null,2)+'\n');
 }
 console.log(JSON.stringify({out,video:opt['storyboard-only']?null:(fs.existsSync(path.join(out,'final.mp4'))?path.join(out,'final.mp4'):video),seconds,frames:count,shots:visible.length,storyboard:'storyboard.jpg',frame_order_independent:true,perceptual_approval:false},null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
