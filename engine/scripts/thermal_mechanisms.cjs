'use strict';
const TAU=2*Math.PI,clamp=(v,lo=0,hi=1)=>Math.max(lo,Math.min(hi,v));
function sample(keys,t){if(t<=keys[0][0])return keys[0].slice(1);for(let i=1;i<keys.length;i++)if(t<=keys[i][0]){const a=keys[i-1],b=keys[i],q=(t-a[0])/(b[0]-a[0]);return a.slice(1).map((v,j)=>v+q*(b[j+1]-v));}return keys.at(-1).slice(1);}
function wrap(v){return((v%1)+1)%1;}
function path(ctx,draw,fill,stroke,width=1){ctx.beginPath();draw(ctx);if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke();}}
function round(ctx,x,y,w,h,r,fill){path(ctx,c=>c.roundRect(x,y,w,h,r),fill);}
function text(ctx,words,x,y,size,color,font='Reel Reference Bold'){ctx.__recordDraw?.('text.label');ctx.save();ctx.font=`bold ${size}px "${font}"`;ctx.textAlign='center';ctx.textBaseline='alphabetic';ctx.fillStyle=color;ctx.fillText(words,x,y);ctx.restore();}
function panState(kit,style,spec={}){
 if(spec.calibration)throw new Error('Historical calibration fixtures are not bundled; use authored animation state.');
 const t=spec.time||0,p=style.pan;
 const bt=spec.bubble_time??t,wt=spec.water_time??t,st=spec.steam_time??t,ft=spec.flame_time??t;
 const heat=clamp(spec.heat??1);let water,bubbles=[];
 {water=p.water_x.map((_,i)=>p.water_y+Math.sin(wt*3.7+i*1.1)*1.9);const rng=kit.flow.seeded(spec.seed??p.seed);for(let i=0;i<(spec.count??p.bubble_count);i++){const x=-117+rng()*234,offset=rng(),speed=.23+rng()*.23,size=3.4+rng()*7.1,q=wrap(bt*speed+offset);bubbles.push({x:x+Math.sin(q*6.2+i)*3,y:65-q*111,r:size*(.55+q*.5),fill:(i%3===0?.48:.13)*clamp((q-.2)/.5),alpha:Math.min(1,q/.06,(1-q)/.08)*heat});}}
 const steam=Array.from({length:4},(_,i)=>{const q=wrap(st*(.34+i*.027)+p.steam_phases[i]);return{x:-84+i*56+Math.sin(st*1.8+i)*5,y:-78-q*117,h:49+(i%3)*8,alpha:Math.sin(Math.PI*q)*p.steam_alpha*heat,phase:q};});
 const rng=kit.flow.seeded(p.flame_seed),flames=Array.from({length:p.flame_count},(_,i)=>{const x=-112+rng()*227,phase=rng(),height=2.4+rng()*3.4;return{x,y:86+Math.sin(ft*(7+i%4)+phase*TAU)*2.1,h:height,alpha:(.26+.68*(.5+.5*Math.sin(ft*12+phase*TAU)))*heat};});
 return{water,bubbles,steam,flames,heat};
}
function drawBubble({ctx,kit,style,x,y,r,fill=.2,alpha=1,mature=false}){
 kit.material.ellipse(ctx,x,y,r,r,'#dceffc',fill*alpha);
 path(ctx,c=>c.arc(x,y,r,0,TAU),null,kit.material.rgba('#e1f1fd',style.pan.bubble_rim_alpha*alpha*(1-.77*clamp(Number(mature)))),style.pan.bubble_stroke);
}
function drawPan({ctx,kit,style,...spec}){
 const state=panState(kit,style,spec),p=style.pan,scale=(spec.w??290)/290;
 ctx.save();ctx.translate(spec.x??0,spec.y??0);ctx.scale(scale,scale);
 const oval=(x,y,rx,ry,fill,a=1)=>kit.material.ellipse(ctx,x,y,rx,ry,fill,a),line=(pts,c,w,a=1)=>kit.path.strokePath(ctx,pts,c,w,a),grad=(a,b,stops)=>kit.material.linear(ctx,0,a,0,b,stops);
 oval(0,91,145,13.5,'#182332');kit.material.softEllipse(ctx,0,87,143,14,'#ffb254',.68*state.heat);
 for(const f of state.flames){kit.material.softEllipse(ctx,f.x,f.y,7,8,'#ffb75e',f.alpha*.57);oval(f.x,f.y-f.h*.3,1.55,f.h,'#ffd08a',f.alpha);}
 ctx.save();ctx.translate(-231,-45);ctx.rotate(-.11);round(ctx,-4,-7,100,13,6,'#172638');line([[1,-4],[88,-4]],'#35435a',1.4,.65);ctx.restore();
 const bowl=c=>{c.moveTo(-146,-73);c.lineTo(144,-73);c.lineTo(132,62);c.quadraticCurveTo(130,73,113,73);c.lineTo(-119,73);c.quadraticCurveTo(-132,73,-134,61);c.closePath();};
 path(ctx,bowl,grad(-73,73,p.bowl_stops));ctx.save();ctx.beginPath();bowl(ctx);ctx.clip();
 function waterPath(c){const points=p.water_x.map((x,i)=>[x-270,state.water[i]]);c.moveTo(-150,state.water[0]);for(let i=0;i<points.length-1;i++){const a=points[i],b=points[i+1];c.quadraticCurveTo(a[0],a[1],(a[0]+b[0])/2,(a[1]+b[1])/2);}c.lineTo(150,state.water.at(-1));c.lineTo(150,78);c.lineTo(-150,78);c.closePath();}
 path(ctx,waterPath,grad(-47,73,p.water_stops));ctx.save();ctx.beginPath();waterPath(ctx);ctx.clip();
 for(const b of state.bubbles)drawBubble({ctx,kit,style,...b,mature:clamp((-6-b.y)/12)*clamp((b.r-8)/2)});
 ctx.restore();ctx.restore();
 // Cross-section: dark side/bottom wall, separate thin grey upper/back rim.
 ctx.save();ctx.lineJoin='round';ctx.lineCap='round';path(ctx,c=>{c.moveTo(-146,-73);c.lineTo(-134,61);c.quadraticCurveTo(-132,73,-119,73);c.lineTo(113,73);c.quadraticCurveTo(130,73,132,62);c.lineTo(144,-73);},null,'#192c3e',p.wall_width);ctx.restore();
 line([[-148,-73],[146,-73]],'#6c7888',3.2,.9);
 for(const s of state.steam)kit.path.curve(ctx,[[s.x,s.y],[s.x-26,s.y-s.h*.35],[s.x+20,s.y-s.h*.60],[s.x-1,s.y-s.h]],'#d8e6f0',p.steam_stroke,s.alpha);
 ctx.restore();return state;
}
function drawGauge({ctx,kit,style,x=0,y=0,r=52,level=0,needle,needle_angle,arc_angle,labels=false,font='Reel Reference Bold',accent}){
 const g=style.gauge,scale=r/52,ring=arc_angle??g.low+(g.ring_high-g.low)*clamp(level),angle=needle_angle??g.low+(g.needle_high-g.low)*clamp(needle??level);
 ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);const oval=(x,y,rx,ry,fill,a=1)=>kit.material.ellipse(ctx,x,y,rx,ry,fill,a),line=(p,c,w,a=1)=>kit.path.strokePath(ctx,p,c,w,a);
 oval(0,.6,53,53,kit.material.linear(ctx,0,-53,0,53,[[0,'#667285'],[.12,'#263448'],[1,'#111d30']]),.8);oval(0,0,52,52,kit.material.linear(ctx,0,-52,0,52,g.body_stops));
 if(ring>g.low+.02){ctx.save();ctx.lineCap='round';path(ctx,c=>c.arc(0,0,46,g.low,ring),null,accent||g.amber,4.8);ctx.restore();}
 for(let i=0;i<13;i++){const a=g.low+(g.needle_high-g.low)*i/12,major=i%3===0;line([[Math.cos(a)*(major?38.7:41),Math.sin(a)*(major?38.7:41)],[Math.cos(a)*46,Math.sin(a)*46]],a<=ring?'#efd6ae':'#c2cddd',major?1.9:1.55,a<=ring?.74:.91);}
 oval(0,0,30.5,30.5,'#8a98ac');oval(0,-.4,29.4,29.4,kit.material.linear(ctx,0,-30,0,30,g.face_stops));
 const tip=[Math.cos(angle)*23.7,Math.sin(angle)*23.7],warm=angle>g.low+.25;
 line([[0,0],tip],'#c3ccd8',10.8);line([[Math.cos(angle)*17,Math.sin(angle)*17],[Math.cos(angle)*23,Math.sin(angle)*23]],warm?'#e8ab64':'#687489',4.9);oval(0,0,5.1,5.1,'#c3ccd8');
 if(labels){const copy=Array.isArray(labels)?labels:['LOW','MAX'];text(ctx,copy[0],-33,70,12,'#e3e8e9',font);text(ctx,copy[1],34,70,12,'#e6b577',font);}
 ctx.restore();return{angle,arc:ring};
}
function drawThermometer({ctx,kit,style,x=0,y=0,h=250,r=27,level=0,cool=0,label,font='Reel Reference Bold'}){
 const sy=h/250,sx=r/27,th=style.thermometer;ctx.save();ctx.translate(x,y);ctx.scale(sx,sy);
 const oval=(x,y,rx,ry,fill,a=1)=>kit.material.ellipse(ctx,x,y,rx,ry,fill,a),line=(p,c,w,a=1)=>kit.path.strokePath(ctx,p,c,w,a);
 round(ctx,-16.5,-250,33,262,16.5,'#39485e');oval(0,0,28,28,'#39485e');round(ctx,-10.8,-244,21.6,250,10.8,kit.material.linear(ctx,-12,0,12,0,th.tube_stops));oval(0,0,22.4,22.4,'#f3f3e9');
 const cooling=clamp(cool);
 const mercury=cooling>0?th.mercury_stops.map(([p,color])=>[p,kit.material.mix(color,p<.5?'#a4cce6':'#73a8cc',cooling)]):th.mercury_stops;
 const bulb=cooling>0?kit.material.mix('#eba04b','#88b7da',cooling):'#eba04b';
 const top=-clamp(level)*250;round(ctx,-6.2,top,12.4,Math.max(1,10-top),6.2,kit.material.linear(ctx,0,top,0,18,mercury));oval(0,0,17.4,18.5,bulb);
 line([[-24,-7],[-24,4]],'#d4dce1',1.2,.8);
 for(let i=0;i<5;i++){const yy=-201+i*36;line([[11.5,yy],[21,yy]],'#c9d4df',1.8,.94);}
 if(label){round(ctx,-18,32,36,23,11,'#17293a');text(ctx,label,0,48,12,'#f3f5ef',font);}
 ctx.restore();return{level:clamp(level),top:y+top*sy};
}
module.exports={sample,panState,drawBubble,drawPan,drawGauge,drawThermometer};
