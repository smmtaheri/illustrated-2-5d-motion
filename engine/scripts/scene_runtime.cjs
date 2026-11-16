'use strict';

// One frame evaluator for storyboard, probes and final renders. Frame order
// never affects the result. New subjects may supply a declared scene module.
const fs=require('node:fs'),path=require('node:path');
const {createCanvas,loadImage,GlobalFonts}=require('@napi-rs/canvas');
const kit=require('./motion_kit.cjs');
const {clamp,lerp,smooth,range}=kit.easing;
const {linear,rgba,ellipse,drawCover}=kit.material;
const {strokePath}=kit.path;

const fontRuntime=require('./font_runtime.cjs');

function tween(value,t){
 if(!value||typeof value!=='object'||!Array.isArray(value.keys))return value;
 const keys=value.keys;if(!keys.length)throw new Error('Empty animation keys.');
 if(t<=keys[0][0])return keys[0][1];if(t>=keys.at(-1)[0])return keys.at(-1)[1];
 const i=keys.findIndex(k=>k[0]>t),a=keys[i-1],b=keys[i];let q=(t-a[0])/(b[0]-a[0]);
 if(value.ease==='smooth')q=smooth(q);
 return lerp(a[1],b[1],q);
}
function at(obj,t){return Object.fromEntries(Object.entries(obj||{}).map(([k,v])=>[k,tween(v,t)]));}
function sampleFrames(keys,frame){
 const right=keys.findIndex(key=>key[0]>frame);
 if(right===0)return keys[0].slice(1);
 if(right<0)return keys.at(-1).slice(1);
 const a=keys[right-1],b=keys[right],q=(frame-a[0])/(b[0]-a[0]);
 return a.slice(1).map((value,i)=>lerp(value,b[i+1],q));
}
function glowingWipe(ctx,draw,layers,width,height,edge){
 const unit=width/540,[top,bottom,core]=edge.map(value=>value*unit);
 draw(layers[0]);
 const outside=Math.min(-width,top-width,bottom-width);
 ctx.save();
 ctx.beginPath();
 ctx.moveTo(outside,0);
 ctx.lineTo(top,0);
 ctx.lineTo(bottom,height);
 ctx.lineTo(outside,height);
 ctx.closePath();
 ctx.clip();
 draw(layers[1]);
 ctx.restore();
 const length=Math.hypot(bottom-top,height),radius=core*.94;
 const dx=height/length*radius,dy=(top-bottom)/length*radius;
 const light=ctx.createLinearGradient(top-dx,-dy,top+dx,dy);
 light.addColorStop(0,'rgba(255,157,61,0)');
 light.addColorStop(.24,'rgba(255,160,65,.35)');
 light.addColorStop(.39,'rgba(255,178,89,.82)');
 light.addColorStop(.50,'#fff0c4');
 light.addColorStop(.61,'rgba(255,178,89,.82)');
 light.addColorStop(.76,'rgba(255,160,65,.35)');
 light.addColorStop(1,'rgba(255,157,61,0)');
 ctx.fillStyle=light;
 ctx.fillRect(0,0,width,height);
}
function smoothLine(ctx,points,move=true){
 if(move)ctx.moveTo(...points[0]);
 for(let i=1;i<points.length-1;i++){const p=points[i],next=points[i+1];ctx.quadraticCurveTo(p[0],p[1],(p[0]+next[0])/2,(p[1]+next[1])/2);}
 ctx.lineTo(...points.at(-1));
}
function strokeSmooth(ctx,points,color,width,alpha){ctx.save();ctx.beginPath();smoothLine(ctx,points);ctx.strokeStyle=color;ctx.globalAlpha*=alpha;ctx.lineWidth=width;ctx.lineJoin='round';ctx.stroke();ctx.restore();}
function flagSample(data,name,time){
 const p=data.profiles[name];if(!p)throw new Error(`Missing cloth profile: ${name}`);
 if(!Number.isFinite(time)||time<0||time>(p.samples.length-1)/data.fps+1e-6)throw new Error('Measured cloth interval exceeded; build a reviewed periodic rig for a longer shot instead of freezing the last sample.');
 const f=clamp(time*data.fps,0,p.samples.length-1),a=p.samples[Math.floor(f)],b=p.samples[Math.min(p.samples.length-1,Math.ceil(f))],q=f-Math.floor(f);
 const arr=k=>a[k].map((v,i)=>Array.isArray(v)?v.map((x,j)=>lerp(x,b[k][i][j],q)):lerp(v,b[k][i],q));
 return {x:arr('x'),top:arr('top'),bottom:arr('bottom'),rgb:arr('rgb'),attachment:p.attachment};
}
function drawMeasuredFlag(ctx,data,name,time,options={}){
 const s=flagSample(data,name,time*(options.speed??1)),amp=options.amplitude??1;
 const anchor=options.anchor||s.attachment;
 const direction=name==='night'?-1:1,span=Math.abs(s.x.at(-1)-s.x[0])+3;
 const top=[],bottom=[];
 for(let i=0;i<s.x.length;i++){
  const u=i/(s.x.length-1),x=anchor[0]+direction*u*span;
  // The source finial can touch the orange mask at the first column. Do not
  // subtract that contaminated pixel from the entire cloth profile.
  top.push([x,i===0?anchor[1]:anchor[1]+(s.top[i]-526)*amp]);
  bottom.push([x,i===0?anchor[1]+74:anchor[1]+74+(s.bottom[i]-600)*amp]);
 }
 ctx.save();ctx.beginPath();smoothLine(ctx,top);ctx.lineTo(...bottom.at(-1));smoothLine(ctx,[...bottom].reverse(),false);ctx.closePath();ctx.clip();
 const x0=Math.min(top[0][0],top.at(-1)[0]),x1=Math.max(top[0][0],top.at(-1)[0]);
 const grad=ctx.createLinearGradient(top[0][0],0,top.at(-1)[0],0);
 s.rgb.forEach((rgb,i)=>grad.addColorStop(i/(s.rgb.length-1),`rgb(${rgb.map(Math.round).join(',')})`));
 ctx.fillStyle=grad;ctx.fillRect(x0-1,490,x1-x0+2,150);
 ctx.fillStyle=linear(ctx,0,510,0,610,[[0,rgba('#ffe2a3',.10)],[.45,'rgba(0,0,0,0)'],[1,rgba('#79421d',.12)]]);ctx.fillRect(x0-1,490,x1-x0+2,150);
 // Broad shading and narrow fold creases are separate material layers.
 for(const u of [.32,.56,.80]){
  const i=Math.round(u*(top.length-1)),line=[[top[i][0],top[i][1]],[bottom[i][0],bottom[i][1]]];
  strokePath(ctx,line,'#9a5926',5.5,name==='day'?.17:.14);
  strokePath(ctx,line,'#9a5926',2.1,name==='day'?.32:.27);
 }
 ctx.restore();strokeSmooth(ctx,top,'#f9d69c',1.2,.80);strokeSmooth(ctx,bottom,'#94582b',1.15,.72);
 strokePath(ctx,[top.at(-1),bottom.at(-1)],'#ba783a',1.1,.65);
 return {topAnchor:top[0],bottomAnchor:bottom[0],freeTop:top.at(-1),freeBottom:bottom.at(-1)};
}
function pole(ctx,x){
 ellipse(ctx,x+1,803,15,3,'#0b2034',.65);
 ctx.fillStyle=linear(ctx,x-4,0,x+4,0,[[0,'#0d1c2e'],[.42,'#465567'],[.55,'#182b40'],[1,'#081423']]);ctx.fillRect(x-3.5,520,7,283);
 strokePath(ctx,[[x-1.8,526],[x-1.8,801]],'#8d9aa8',.75,.55);
}
function finial(ctx,x){ellipse(ctx,x,518,7,7,'#172230');ellipse(ctx,x,518,5.6,5.6,'#f5ca7f');}
function directionArrow(ctx,x0,x1,y,color){
 const d=Math.sign(x1-x0);ctx.save();ctx.shadowColor=rgba(color,.35);ctx.shadowBlur=8;
 strokePath(ctx,[[x0,y],[x1-d*12,y]],color,9,.98);
 ctx.beginPath();ctx.moveTo(x1-d*2,y-1.8);ctx.quadraticCurveTo(x1+d*.5,y,x1-d*2,y+1.8);ctx.lineTo(x1-d*12,y+10);ctx.quadraticCurveTo(x1-d*15,y+12,x1-d*15,y+8);ctx.lineTo(x1-d*15,y-8);ctx.quadraticCurveTo(x1-d*15,y-12,x1-d*12,y-10);ctx.closePath();ctx.fillStyle=color;ctx.fill();ctx.restore();
}
function fixedPill(ctx,text,x,y,w,fill,color,language='en'){
 ctx.save();ctx.shadowColor='rgba(8,20,35,.30)';ctx.shadowBlur=7;ctx.shadowOffsetY=2;
 ctx.beginPath();ctx.roundRect(x-w/2,y-15,w,30,15);ctx.fillStyle=linear(ctx,0,y-15,0,y+15,[[0,kit.material.mix(fill,'#fff0dc',.09)],[1,kit.material.mix(fill,'#512b29',.08)]]);ctx.fill();ctx.shadowColor='transparent';
 ctx.font=language==='fa'?'bold 17px "Motion Persian Bold"':'bold 17px "Reel Reference Bold"';ctx.textAlign='center';ctx.textBaseline='alphabetic';ctx.fillStyle=color;ctx.fillText(text,x,y+5.5);ctx.restore();
}
function referenceHeading(ctx,copy,language,time){
 if(language==='fa'){
  kit.text.heading(ctx,{lines:copy.heading||['همان پرچم','بادِ مخالف'],subtitle:copy.subtitle||'همان دره',size:43,y:160,time:1});return;
 }
 const line1=copy.line1??'SAME FLAG.',left=copy.highlight??'OPPOSITE',right=copy.rest??' WIND.';
 ctx.save();ctx.textBaseline='alphabetic';
 if(time>=2/30-1e-8){
  const scale=tween({keys:[[2/30,1.32],[.1,1.21],[4/30,1.12],[5/30,1.07],[.2,1.035],[7/30,1.01],[8/30,1]]},time);
  ctx.save();ctx.translate(270,178);ctx.scale(scale,scale);ctx.translate(-270,-178);const blur=Math.max(0,2.8*(1-range(time,2/30,.23)));ctx.filter=blur<.01?'none':`blur(${blur}px)`;
  ctx.shadowColor='rgba(18,25,38,.26)';ctx.shadowBlur=4;ctx.shadowOffsetY=2;ctx.fillStyle='#f6f5ee';ctx.textAlign='center';
  ctx.save();ctx.translate(271,166);ctx.scale(.933,1);ctx.font='bold 53px "Reel Reference Bold"';ctx.fillText(line1,0,0);ctx.restore();
  ctx.font='bold 53px "Reel Reference Bold"';ctx.save();ctx.translate(273,0);ctx.scale(.963,1);const w=ctx.measureText(left+right).width,x=-w/2;ctx.textAlign='left';ctx.fillStyle='#f3bb66';ctx.fillText(left,x,222);const split=x+ctx.measureText(left).width;ctx.fillStyle='#f6f5ee';ctx.fillText(right,split,222);ctx.restore();ctx.restore();
 }
 const reveal=kit.easing.easeOut(range(time,.25,.45));ctx.fillStyle=linear(ctx,58,227,315,234,[[0,'#f2b85b'],[1,'#d58a2d']]);ctx.fillRect(58,227,257*reveal,7);
 ctx.globalAlpha=smooth(range(time,.15,.35));ctx.textAlign='center';ctx.font='bold 26px "Reel Reference Bold"';ctx.fillStyle='#f6f5ee';ctx.fillText(copy.subtitle??'same valley',270,266);ctx.restore();
}

async function createProject(planFile,options={}){
 const plan=typeof planFile==='string'?JSON.parse(fs.readFileSync(planFile,'utf8')):planFile;
 const base=typeof planFile==='string'?path.dirname(path.resolve(planFile)):path.resolve(options.base||'.');
 const config=plan.project;if(!config||!Number.isFinite(config.duration_seconds)||config.duration_seconds<=0)throw new Error('Invalid project duration.');
 const fps=config.fps||30,width=options.width||config.width,height=Math.round(width*config.height/config.width);
 if(!Number.isInteger(width)||width<2||width%2||height%2)throw new Error('Require positive even encoded dimensions.');
 const canvas=createCanvas(width,height),outputCtx=canvas.getContext('2d'),images=new Map(),data=new Map(),modules=new Map(),assets=new Map(),consumed=new Map(),fonts=new Map();
 let ctx=outputCtx;
 const layers=[createCanvas(width,height),createCanvas(width,height)];
 const language=config.language?.resolved?.screen_text||'en';
 const typography=kit.text.typographyFor(language,/^en(-|$)/i.test(language)?{regularStack:'"Reel Reference Sans"',boldStack:'"Reel Reference Bold"',lineHeight:1.1}:{});
 kit.text.configureContext(ctx,typography);
 for(const a of plan.assets||[]){
  const file=path.resolve(base,a.path);assets.set(a.id,{...a,file});
  if(/\.(png|jpg|jpeg|webp|svg)$/i.test(file))images.set(a.id,await loadImage(file));
  else if(/\.json(?:\.gz)?$/i.test(file)){const bytes=fs.readFileSync(file),text=file.endsWith('.gz')?require('node:zlib').gunzipSync(bytes).toString('utf8'):bytes.toString('utf8');data.set(a.id,JSON.parse(text));}
  else if(a.kind==='font'){
   const name=path.basename(file).replace(/^\d+-/,''),family=a.font_family||({
    'LiberationSans-Regular.ttf':'Reel Reference Sans','LiberationSans-Bold.ttf':'Reel Reference Bold',
    'NotoSansArabic-Regular.ttf':'Motion Persian','NotoSansArabic-Bold.ttf':'Motion Persian Bold',
    'DejaVuSans.ttf':'Motion Sans','DejaVuSans-Bold.ttf':'Motion Sans Bold'
   })[name];
   if(!family)throw new Error(`Declare font_family for ${a.id}`);
   fontRuntime.register(file,family,a.sha256);
   fonts.set(a.id,{file,family});
  }
 }
 fontRuntime.projectDefaults(new Set([...fonts.values()].map(f=>f.family)));
 const image=id=>{if(!images.has(id))throw new Error(`Missing image ${id}`);consumed.set(id,assets.get(id).file);return images.get(id);};
 const datum=id=>{if(!data.has(id))throw new Error(`Missing data ${id}`);consumed.set(id,assets.get(id).file);return data.get(id);};
 const component=id=>{
  const asset=assets.get(id);if(!asset||!/[.](c?js)$/i.test(asset.file))throw new Error(`Missing component ${id}`);
  if(!modules.has(asset.file))modules.set(asset.file,require(asset.file));
  consumed.set(id,asset.file);return modules.get(asset.file);
 };
 const events=new Map((plan.events||[]).map(e=>[e.id,e.time]));
 const eventTime=id=>{if(!events.has(id))throw new Error(`Unknown event ${id}`);return events.get(id);};
 let activeShot=null,textUsed=false;
 const kitFile=fs.realpathSync(path.join(__dirname,'motion_kit.cjs'));
 const recordDraw=exportName=>{
  if(exportName.startsWith('text.'))textUsed=true;if(exportName.startsWith('font.'))for(const[id,font]of fonts)if(font.family===exportName.slice(5))consumed.set(id,font.file);
  for(const id of activeShot?.asset_ids||[]){
   const a=assets.get(id);
   if(a?.implementation?.exports?.includes(exportName)&&fs.realpathSync(a.file)===kitFile)consumed.set(id,a.file);
  }
 };
 for(const target of [outputCtx,...layers.map(c=>c.getContext('2d'))]){kit.text.configureContext(target,typography);target.__recordDraw=recordDraw;}
 const grain=kit.material.paperTexture(1080,1920),macro=kit.scenes?.createMacroSky(grain),ground=kit.scenes?.createPlanGround(grain);
 function scene(shot,t,headingOpacity,headingTransform){
  const spec=shot.renderer||{},local=t-shot.start,duration=shot.end-shot.start,p=clamp(local/duration),params=at(spec.params,local);
  if(spec.type==='day-night'){
   const backdrop=image(spec.background);drawCover(ctx,backdrop);ctx.save();ctx.beginPath();ctx.rect(271,0,269,960);ctx.clip();ctx.filter='saturate(.87)';drawCover(ctx,backdrop);ctx.restore();kit.material.applyGrain(ctx,grain,.38);const profile=datum(spec.motion);
   pole(ctx,135);pole(ctx,405);drawMeasuredFlag(ctx,profile,'day',local,params);drawMeasuredFlag(ctx,profile,'night',local,params);finial(ctx,135);finial(ctx,405);
   fixedPill(ctx,spec.copy?.day??(language==='fa'?'بعدازظهر':'AFTERNOON'),135,350,125,'#eaaa4b','#13212d',language);
   fixedPill(ctx,spec.copy?.night??(language==='fa'?'شب':'NIGHT'),405,350,73,'#db7568','#faf4e9',language);
   const swell=1+.018*Math.sin(t*2.1);directionArrow(ctx,125,125+100.5*swell,850,'#eca345');directionArrow(ctx,415,415-100.5*swell,850,'#d77c70');
   textUsed=true;referenceHeading(ctx,spec.copy||{},language,local);return;
  }
  if(spec.type==='module'){
   const file=path.resolve(base,spec.module);if(!modules.has(file))modules.set(file,require(file));
   modules.get(file).drawScene({ctx,plan,shot,time:t,localTime:local,progress:p,width:540,height:960,kit,image,data:datum,component,eventTime,params,headingOpacity,headingTransform});
   for(const id of shot.asset_ids||[])if(assets.get(id)?.file===file)consumed.set(id,file);
   return;
  }
  if(spec.type==='layers'){
   ctx.fillStyle=spec.background||kit.PALETTE.sky;ctx.fillRect(0,0,540,960);
   for(const raw of spec.layers||[]){const v=at(raw,local);ctx.save();ctx.globalAlpha=v.opacity??1;ctx.translate(v.x||0,v.y||0);ctx.rotate((v.rotation||0)*Math.PI/180);ctx.scale(v.scale??1,v.scale??1);
    if(v.kind==='image')ctx.drawImage(image(v.asset_id),-(v.width||100)/2,-(v.height||100)/2,v.width||100,v.height||100);
    else if(v.kind==='drop')kit.material.droplet(ctx,0,0,v.radius||20,{color:v.color||'#c7dce7'});
    else if(v.kind==='arrow')kit.path.arrow(ctx,0,0,0,v.length||40,v.color||kit.PALETTE.amber,v.line_width||4,1);
    else if(v.kind==='text')kit.text.label(ctx,v.text,0,0,{size:v.size||24,align:'center',color:v.color||kit.PALETTE.ivory});
    else throw new Error(`Unknown layer kind ${v.kind}`);ctx.restore();
   }return;
  }
  if(kit.scenes?.drawPlannedVirga&&spec.type?.startsWith('virga-')){
   kit.scenes.drawPlannedVirga(ctx,{type:spec.type,t:local,p,duration,grain,macroSky:macro,backdrop:image(spec.background),cloudImage:spec.cloud?image(spec.cloud):null,params,language});
   return;
  }
  if(['thermal-section','thermal-plan','transfer-context','transfer-comparison'].includes(spec.type)){
   const fn={'thermal-section':'thermalSection','thermal-plan':'thermalPlan','transfer-context':'transferContext','transfer-comparison':'transferComparison'}[spec.type];
   kit.scenes[fn](ctx,{t:local,p,grain,backdrop:spec.background?image(spec.background):null,cloudImage:spec.cloud?image(spec.cloud):null,planGround:ground,labels:kit.LABELS[language]||kit.LABELS.en});
   return;
  }
  throw new Error(`Unsupported scene type ${spec.type}; declare a scene module rather than substituting a generic scene.`);
 }
 function paintShot(shot,t,target,renderOptions={}){
  ctx=target.getContext('2d');ctx.__motionTitleBounds=renderOptions.onTitleBounds;ctx.__motionTitleUnderline=renderOptions.onTitleUnderline;
  activeShot=shot;textUsed=false;
  ctx.setTransform(width/540,0,0,height/960,0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.filter='none';ctx.shadowColor='transparent';ctx.shadowBlur=0;ctx.shadowOffsetX=0;ctx.shadowOffsetY=0;ctx.setLineDash([]);ctx.clearRect(0,0,540,960);ctx.fillStyle='#304b70';ctx.fillRect(0,0,540,960);ctx.save();
  const headingTransform=shot.renderer?.heading_space==='screen'?ctx.getTransform():undefined;
  const cam=at(shot.renderer?.camera,t-shot.start);if(!renderOptions.lockedCamera&&cam.scale){ctx.translate(cam.x||0,cam.y||0);ctx.scale(cam.scale,cam.scale);}
  const headingOpacity=renderOptions.hideHeadings?0:renderOptions.headingOpacity;
  scene(shot,t,headingOpacity,headingTransform);ctx.restore();
  if(!renderOptions.hideHeadings&&shot.renderer?.type!=='day-night'&&shot.renderer?.auto_heading!==false&&shot.screen_text?.heading?.length){
   kit.text.heading(ctx,{lines:shot.screen_text.heading,subtitle:shot.screen_text.support||'',highlight:shot.screen_text.highlight_index??1,size:language==='fa'?45:51,y:166,subtitleGap:44,profile:'calibrated',time:Math.max(0,t-shot.start)});
  }
  // Do not turn merely declared assets into proof that they were rendered.
  // Image/data helpers record actual calls; default text uses these families.
  const familyPrefix=typography.direction==='rtl'?'Motion Persian':'Reel Reference';
  for(const [id,font]of fonts)if(textUsed&&font.family.startsWith(familyPrefix))consumed.set(id,font.file);
  if(shot.renderer?.exposure_keys){const keys=shot.renderer.exposure_keys,f=t*fps,j=keys.findIndex(k=>k[0]>f),a=j<0?keys.at(-1)[1]:j===0?keys[0][1]:keys[j-1][1]+(keys[j][1]-keys[j-1][1])*(f-keys[j-1][0])/(keys[j][0]-keys[j-1][0]),c=shot.renderer.exposure_dark_rgb||[13,25,43];if(a<1){ctx.save();ctx.globalAlpha=1;ctx.filter='none';ctx.fillStyle=`rgba(${c.join(',')},${1-clamp(a)})`;ctx.fillRect(0,0,540,960);ctx.restore();}}
  else if(shot.renderer?.exit_fade_frames){const seconds=shot.renderer.exit_fade_frames/fps,q=clamp((t-(shot.end-seconds))/seconds);if(q>0){ctx.save();ctx.fillStyle=`rgba(13,25,43,${q})`;ctx.fillRect(0,0,540,960);ctx.restore();}}
 }
 function renderFrame(frame,renderOptions={}){
  const total=Math.round(config.duration_seconds*fps);if(!Number.isFinite(frame))throw new Error('Invalid frame.');frame=clamp(frame,0,total-1);const t=frame/fps;
  const index=plan.shots.findIndex(s=>t>=s.start-1e-8&&t<s.end-1e-8),shot=plan.shots[index];if(!shot)throw new Error(`Uncovered frame ${frame}.`);
  const tr=typeof shot.transition==='object'?shot.transition:{type:shot.transition},span=tr.duration_seconds||0;
  const supported=new Set(['cut','none','fade','dissolve','match_cut','wipe','slide','zoom_dissolve','dip']);
  if(!supported.has(tr.type))throw new Error(`Unsupported transition ${tr.type}`);
  if(!index||span<=0||t>=shot.start+span||['cut','none','match_cut'].includes(tr.type))paintShot(shot,t,canvas,renderOptions);
  else{
   const previous=plan.shots[index-1],p=clamp((t-shot.start)/span),localFrame=(t-shot.start)*fps;
   const q=tr.progress_keys?clamp(sampleFrames(tr.progress_keys,localFrame)[0]):smooth(p);
   const outgoing = previous.renderer?.heading_transition === 'stagger'
    ? {...renderOptions,headingOpacity:1-smooth(clamp(p/.42))} : renderOptions;
   const incoming = shot.renderer?.heading_transition === 'stagger'
    ? {...renderOptions,headingOpacity:smooth(clamp((p-.56)/.44))} : renderOptions;
   paintShot(previous,tr.continue_motion?t:previous.end-1/fps,layers[0],outgoing);paintShot(shot,t,layers[1],incoming);
   ctx=outputCtx;ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.filter='none';ctx.shadowColor='transparent';ctx.clearRect(0,0,width,height);ctx.fillStyle='#0d192b';ctx.fillRect(0,0,width,height);
   const draw=(image,alpha=1,x=0,y=0,scale=1)=>{if(alpha<=0)return;ctx.save();ctx.globalAlpha=alpha;ctx.translate(width/2+x,height/2+y);ctx.scale(scale,scale);ctx.drawImage(image,-width/2,-height/2);ctx.restore();};
   if(tr.type==='slide'){
    const horizontal=tr.direction==='left'||tr.direction==='right',sign=(tr.direction==='down'||tr.direction==='right')?-1:1,d=horizontal?width:height,blur=(tr.motion_blur??3)*Math.sin(p*Math.PI);
    ctx.filter=blur<.01?'none':`blur(${blur}px)`;
    draw(layers[0],1,horizontal?-q*d*sign:0,horizontal?0:-q*d*sign);draw(layers[1],1,horizontal?(1-q)*d*sign:0,horizontal?0:(1-q)*d*sign);ctx.filter='none';
   }else if(tr.type==='wipe'&&tr.edge_keys){
    glowingWipe(ctx,draw,layers,width,height,sampleFrames(tr.edge_keys,localFrame));
   }else if(tr.type==='wipe'){
    draw(layers[0]);const sweep=q*(width+height);ctx.save();ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(sweep,0);ctx.lineTo(0,sweep);ctx.closePath();ctx.clip();draw(layers[1]);ctx.restore();ctx.save();ctx.strokeStyle=tr.color||'#eeaf55';ctx.lineWidth=Math.max(2,width*.06*Math.sin(p*Math.PI));ctx.beginPath();ctx.moveTo(sweep,0);ctx.lineTo(0,sweep);ctx.stroke();ctx.restore();
   }else if(tr.type==='zoom_dissolve'&&tr.outgoing_camera_keys){
    const [scale,x,y]=sampleFrames(tr.outgoing_camera_keys,localFrame);
    draw(layers[0],1,x*width/540,y*height/960,scale);
    draw(layers[1],q);
   }else if(tr.type==='zoom_dissolve'){draw(layers[0],1,0,0,1+.16*q);draw(layers[1],q,0,0,1+.08*(1-q));}
   else if(tr.type==='dip'){if(p<.5)draw(layers[0],1-2*p);else draw(layers[1],2*p-1);}
   else {draw(layers[0]);draw(layers[1],q);}
  }
  ctx=outputCtx;
  return canvas;
 }
 return {plan,base,fps,width,height,canvas,renderFrame,eventTime,assets,images,consumed,fontRegistry:fontRuntime.snapshot,totalFrames:Math.round(config.duration_seconds*fps),duration:config.duration_seconds};
}
module.exports={createProject,tween,flagSample,drawMeasuredFlag};
