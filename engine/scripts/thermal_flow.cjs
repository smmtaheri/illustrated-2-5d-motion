'use strict';
const TAU=Math.PI*2,clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v)),wrap=v=>((v%1)+1)%1;
function sample(keys,t){if(t<=keys[0][0])return keys[0].slice(1);for(let i=1;i<keys.length;i++)if(t<=keys[i][0]){const a=keys[i-1],b=keys[i],q=(t-a[0])/(b[0]-a[0]);return a.slice(1).map((v,j)=>v+q*(b[j+1]-v));}return keys.at(-1).slice(1);}
function drawArrow({ctx,kit,style,x=0,y=0,dir=1,alpha=1,length=53,thickness=8,tint,tail}){
 const color=tint||(dir>0?style.arrow.up:style.arrow.down),end=tail||(tint?kit.material.mix(tint,'#17273f',.12):(dir>0?style.arrow.up_tail:style.arrow.down_tail)),h=length,k=thickness/8;
 ctx.save();ctx.translate(x,y);ctx.scale(k,dir);ctx.globalAlpha*=clamp(alpha);ctx.shadowColor=kit.material.rgba(color,style.arrow.glow);ctx.shadowBlur=style.arrow.blur;
 ctx.beginPath();ctx.moveTo(0,-h/2);ctx.quadraticCurveTo(2,-h/2,5,-h/2+4);ctx.lineTo(11,-h/2+13);ctx.quadraticCurveTo(13,-h/2+16,9,-h/2+16);ctx.lineTo(4,-h/2+16);ctx.lineTo(4,h/2-3);ctx.quadraticCurveTo(4,h/2+1,0,h/2+1);ctx.quadraticCurveTo(-4,h/2+1,-4,h/2-3);ctx.lineTo(-4,-h/2+16);ctx.lineTo(-9,-h/2+16);ctx.quadraticCurveTo(-13,-h/2+16,-11,-h/2+13);ctx.lineTo(-5,-h/2+4);ctx.quadraticCurveTo(-2,-h/2,0,-h/2);ctx.closePath();ctx.fillStyle=kit.material.linear(ctx,0,-h/2,0,h/2,[[0,color],[1,end]]);ctx.fill();ctx.restore();
}
function warmAirState(kit,style,{time=0,particle_time=time,haze_time=time,w=60,h=120,seed=42,count=13,opacity=1,...overrides}={}){
 const p={...style.particles,...overrides},rng=kit.flow.seeded(seed),particles=[];
 for(let i=0;i<count;i++){const offset=rng(),sway=rng(),size=p.minSize+rng()*p.sizeRange,q=wrap(offset+particle_time*(p.rate+.045*(i%4)));particles.push({x:(sway-.5)*w*p.spread+Math.sin(particle_time*2+i)*p.sway,y:h*(.63-q*1.3),r:size,alpha:clamp(opacity)*Math.sin(Math.PI*q)*(.26+.42*sway)*p.brightness});}
 return{particles,haze:clamp(opacity)*(p.haze??.3)*(1+(p.hazePulse??0)*Math.sin(haze_time*1.4)),w,h};
}
function drawWarmAir({ctx,kit,style,x=0,y=0,...spec}){
 const state=warmAirState(kit,style,spec),p=style.particles;
 if(spec.column){ctx.save();ctx.globalAlpha*=clamp(spec.opacity??1);kit.material.softColumn(ctx,x,y-state.h/2,y+state.h/2,{width:spec.column_width??state.w,color:style.column.color,alpha:style.column.alpha});ctx.restore();}
 else kit.material.softEllipse(ctx,x,y,state.w,state.h,p.haze_color,state.haze);
 for(const a of state.particles){kit.material.softEllipse(ctx,x+a.x,y+a.y,a.r*p.halo_scale,a.r*p.halo_scale,p.halo_color,a.alpha*p.halo_alpha);ctx.save();ctx.filter='blur(0.75px)';kit.material.ellipse(ctx,x+a.x,y+a.y,a.r,a.r,p.core_color,a.alpha*p.core_alpha);ctx.restore();}
 return state;
}
function drawParcel({ctx,kit,style,x=0,y=0,r=50,power=1,cool=0,profile='full'}){
 const m=style.parcel[profile]||style.parcel.full,soft=(dx,dy,rx,ry,color,a)=>kit.material.softEllipse(ctx,x+dx*r,y+dy*r,rx*r,ry*r,kit.material.mix(color,'#98bacd',clamp(cool)),clamp(power)*a);
 if(profile==='rise'||profile==='mass'){
  ctx.save();ctx.translate(x,y);ctx.scale(1,1.22/1.12);const radius=r*1.12,color=kit.material.mix(m.outer,'#98bacd',clamp(cool)),g=ctx.createRadialGradient(0,0,0,0,0,radius),alpha=clamp(power)*m.outer_alpha;
  for(const [at,a] of [[0,1],[.58,.72],[.84,.36],[1,0]])g.addColorStop(at,kit.material.rgba(color,alpha*a));ctx.fillStyle=g;ctx.fillRect(-radius,-radius,radius*2,radius*2);ctx.restore();
 }else soft(0,0,1.12,1.22,m.outer,m.outer_alpha);
 soft(-.2,.09,.66,.88,m.inner,m.inner_alpha);soft(.23,-.21,.52,.68,m.highlight,m.inner_alpha*.72);
 if(m.core_alpha){ctx.save();ctx.filter='blur(2px)';kit.material.ellipse(ctx,x-3,y-2,r*.43,r*.57,kit.material.mix(m.outer,'#98bacd',clamp(cool)),clamp(power)*m.core_alpha);ctx.restore();}
}
module.exports={sample,drawArrow,warmAirState,drawWarmAir,drawParcel};
