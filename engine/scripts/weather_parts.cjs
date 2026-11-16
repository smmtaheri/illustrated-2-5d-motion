'use strict';

const {createCanvas,Path2D}=require('@napi-rs/canvas');
const profiles={
  // Coordinates are normalized to width, with the base anchored at y=0.
  fair:[[-.32,-.12,.16,.10],[-.17,-.22,.20,.17],[.03,-.27,.23,.19],[.24,-.18,.19,.14],[.37,-.08,.12,.08]],
  rain:[[-.33,-.13,.16,.12],[-.21,-.29,.19,.22],[-.01,-.40,.20,.27],[.16,-.32,.20,.21],[.32,-.17,.17,.15],[.06,-.12,.36,.11]],
  thinning:[[-.30,-.09,.18,.08],[-.11,-.13,.21,.105],[.14,-.14,.24,.10],[.34,-.07,.14,.065]],
};
const cloudCache=new Map(), terrainCache=new Map();
const clamp=x=>Math.max(0,Math.min(1,x));
const mix=(a,b,q)=>a+(b-a)*q;
const smooth=x=>{const q=clamp(x);return q*q*(3-2*q);};
const turn=Math.PI*2;

function cloudPlate(kit,variant,growth) {
  const key=variant+':'+growth;
  if(cloudCache.has(key))return cloudCache.get(key);
  const canvas=createCanvas(620,450), c=canvas.getContext('2d'),m=kit.material;
  c.translate(310,415); c.scale(570,570);
  const lobes=profiles[variant].map(([x,y,rx,ry],i)=>{
    const t=smooth(growth*(1.19-i*.025));
    return [x*(1.27-.27*t),y*mix(.64,1,t),rx*mix(.44,1,t),ry*mix(.59,1,t)];
  });
  const shape=new Path2D();
  for(const [x,y,rx,ry] of lobes){shape.moveTo(x+rx,y);shape.ellipse(x,y,rx,ry,0,0,turn);}
  const rainy=variant==='rain';
  c.beginPath();c.rect(-.56,-.76,1.12,.76);c.clip();c.clip(shape);
  c.fillStyle=m.linear(c,0,-.69,.12,0,rainy?[
    [0,'#d9d6d0'],[.42,'#a7adb8'],[.75,'#74819b'],[1,'#4b5873'],
  ]:[[0,'#fff6e8'],[.49,'#f5eee9'],[.77,'#d6d4df'],[1,'#aeb6cc']]);
  c.fillRect(-.56,-.76,1.12,.76);
  for(const [x,y,rx,ry] of lobes){
    m.softEllipse(c,x+.016,y+ry*.50,rx*1.07,ry*.76,rainy?'#414c65':'#9f9bb6',rainy?.29:.24);
    m.softEllipse(c,x-rx*.22,y-ry*.39,rx*.88,ry*.73,rainy?'#f6e4cf':'#fffdf6',rainy?.48:.61);
  }
  const soft=createCanvas(canvas.width,canvas.height),out=soft.getContext('2d');
  out.filter='blur(1.7px)';out.drawImage(canvas,0,0);
  cloudCache.set(key,soft);
  return soft;
}

let rainVeil;
function rain(api,s,t) {
  const {ctx:c,kit}=api,m=kit.material;
  const w=s.w??250, h=s.rain_depth??225, q=clamp(s.rainfall??0);
  if(!rainVeil){
    rainVeil=createCanvas(220,340);
    const v=rainVeil.getContext('2d');
    v.fillStyle=m.linear(v,0,0,0,340,[[0,'rgba(93,112,135,0)'],[.045,'rgba(93,112,135,.61)'],[.34,'rgba(121,148,168,.45)'],[.74,'rgba(164,186,201,.20)'],[1,'rgba(168,189,205,0)']]);
    v.fillRect(0,0,220,340);
    v.globalCompositeOperation='destination-in';
    v.fillStyle=m.linear(v,0,0,220,0,[[0,'transparent'],[.20,'rgba(0,0,0,.72)'],[.4,'black'],[.72,'rgba(0,0,0,.86)'],[1,'transparent']]);
    v.fillRect(0,0,220,340);
  }
  c.save();c.globalAlpha*=q;c.transform(1,0,w*.13/h,1,0,0);
  c.drawImage(rainVeil,-w*.47,0,w*.94,h);c.restore();
  const rng=kit.flow.seeded(s.seed??412);
  for(let i=0;i<178;i++){
    const x=(rng()-.5)*w*.72, speed=.60+rng()*.63, v=(t*speed+rng())%1, n=rng();
    const xx=x+v*w*.11, yy=v*h, opacity=q*(.14+.53*n)*Math.sin(Math.PI*clamp(v*1.04))**.45;
    kit.path.strokePath(c,[[xx-3,yy-8-13*n],[xx,yy]],n>.7?'#e1ecf2':'#9db7cc',(.55+.55*n)*(s.rain_line_scale??1),clamp(opacity*(s.rain_opacity_scale??1)));
  }
}

function weatherCloud(api,s,clock) {
  const {ctx:c,kit}=api, w=s.w??250, variant=s.variant??'fair';
  if(!profiles[variant])throw new Error('Unknown weather cloud variant '+variant);
  if(s.rainfall>0)rain(api,s,clock.time);
  const plate=cloudPlate(kit,variant,Math.round(clamp(s.formation??1)*32)/32);
  const factor=w/570, stretch=s.loft??1;
  c.drawImage(plate,-310*factor,-415*factor*stretch,620*factor,450*factor*stretch);
}

const ridge=new Path2D('M-22 822 C45 809 86 772 121 730 C155 688 173 661 194 614 C207 582 218 560 238 535 C247 520 254 494 267 485 C274 479 277 480 284 487 C293 499 296 500 306 503 C317 507 317 521 329 530 C346 541 356 568 368 592 C393 644 422 661 450 692 C483 730 518 744 568 769 L568 980 L-22 980 Z');
const planes=[
  ['M-10 829 C75 786 122 788 166 753 C209 718 224 658 240 619 C255 581 267 527 279 484 C282 535 274 570 282 606 C290 656 272 681 249 719 C206 787 181 796 122 824 L-10 890Z','#233d52',.48],
  ['M20 825 C84 789 140 749 176 693 C211 638 214 573 275 484 C253 559 256 614 233 658 C195 731 155 787 20 847Z','#a8b5ae',.16],
  ['M281 486 C314 532 341 551 370 608 C398 671 447 701 537 772 C476 755 425 727 383 690 C340 651 315 625 306 584 C301 557 288 527 281 486Z','#d8b891',.24],
  ['M282 485 C285 539 312 587 311 630 C309 683 349 711 382 737 C409 761 426 791 461 815 C396 789 364 761 334 733 C301 703 282 664 281 626 C280 578 267 565 282 485Z','#584e56',.39],
  ['M21 845 C101 807 170 797 232 746 C263 720 277 682 281 634 C301 721 250 780 189 808 C126 837 78 844 21 869Z','#203748',.40],
];
function sideTerrain(c,kit,s){
  const m=kit.material, storm=clamp(s.wet??.75), dry=clamp(s.dry??.7);
  c.save();c.clip(ridge);
  c.fillStyle=m.linear(c,37,610,505,704,[[0,'#3b5e68'],[.38,'#547480'],[.52,'#657b84'],[.73,'#9c8370'],[1,'#b0926f']]);
  c.fillRect(-30,470,610,520);
  m.softEllipse(c,370,550,246,252,'#f5ce9d',.43*dry);
  m.softEllipse(c,107,668,257,260,'#263d5c',.67*storm);
  c.save();c.filter='blur(3.0px)';
  for(const [d,fill,a] of planes){c.fillStyle=m.rgba(fill,a);c.fill(new Path2D(d));}
  c.restore();
  m.softEllipse(c,209,745,208,105,'#748e95',.23);
  m.softEllipse(c,427,772,178,107,'#bd9f85',.23);
  const r=kit.flow.seeded(462);
  for(let i=0;i<1650;i++){
    const x=r()*540,y=486+r()*365,spread=r();
    const k=.017+r()*.078;
    c.fillStyle=m.rgba(x<275?'#c4d2c1':'#ecd4af',k);
    c.fillRect(x,y,.7+spread*3.0,.55+spread*.60);
  }
  c.restore();
}

function overhead(c,kit){
  const m=kit.material;
  c.fillStyle=m.linear(c,0,0,540,260,[[0,'#304f62'],[.31,'#6f8f92'],[.55,'#7d857a'],[1,'#aa886d']]);c.fillRect(0,0,540,960);
  for(let i=0;i<9;i++){
    const dx=(i-4)*28;
    c.beginPath();c.moveTo(250+dx,-30);c.bezierCurveTo(160+dx,160,363+dx,273,276+dx,435);
    c.bezierCurveTo(207+dx,560,367+dx,660,264+dx,990);
    c.lineWidth=i===4?3.5:1.35;c.strokeStyle=m.rgba(i<4?'#a3c2c6':'#e9c99c',i===4?.54:.24);c.stroke();
  }
  m.softEllipse(c,135,565,210,458,'#233e58',.43);
  m.softEllipse(c,469,582,211,460,'#f3c899',.42);
  c.fillStyle=m.linear(c,0,0,0,465,[[0,'#203a5e'],[1,m.rgba('#203a5e',0)]]);c.fillRect(0,0,540,465);
}
function foothill(c,kit){
  const m=kit.material;
  c.fillStyle=m.linear(c,0,723,0,878,[[0,'#698388'],[1,'#344b59']]);
  c.fill(new Path2D('M-30 818 C28 808 52 778 95 782 C137 785 159 815 189 825 C235 843 277 829 309 845 C398 897 462 896 565 911 L565 985 L-30 985Z'));
  for(const [x,y,r] of [[18,811,11],[47,802,14],[74,795,15],[104,802,10],[132,814,8]]){
    m.softEllipse(c,x+9,y+4,r*1.4,6,'#172d41',.45);
    kit.path.strokePath(c,[[x,y+3],[x-2,y-r*1.35]],'#283f48',1.7,.85);
    m.ellipse(c,x-2,y-r*.83,r*.52,r*.71,'#46636a',.91);
    m.ellipse(c,x+2,y-r*1.24,r*.48,r*.52,'#627c76',.91);
  }
}
function foreground(c,kit){
  const m=kit.material;
  c.fillStyle=m.linear(c,0,797,0,960,[[0,'#233f51'],[1,'#142c42']]);
  c.fill(new Path2D('M-14 855 Q54 819 115 845 T247 865 Q324 865 366 848 T552 839 L552 980 L-14 980Z'));
  c.save();c.filter='blur(2.5px)';
  const r=kit.flow.seeded(4129);
  for(let i=0;i<18;i++){
    const x=r()*540,y=915+r()*56,h=10+r()*51, k=r();
    c.strokeStyle=m.rgba('#0c2438',.18+.34*k);c.lineWidth=1.9+k*2.4;
    c.beginPath();c.moveTo(x-3,y);c.quadraticCurveTo(x,y-h*.63,x-7-9*k,y-h);
    c.moveTo(x-1,y);c.quadraticCurveTo(x+4,y-h*.48,x+10+7*k,y-h*.82);c.stroke();
  }
  c.restore();
}
function relief(api,s){
  const key=JSON.stringify([s.plane,s.wet,s.dry]);
  if(terrainCache.size>=12 && !terrainCache.has(key))terrainCache.delete(terrainCache.keys().next().value);
  if(!terrainCache.has(key)){
    const layer=createCanvas(1080,1920),c=layer.getContext('2d');
    c.scale(2,2);
    if(s.plane==='overhead')overhead(c,api.kit);
    else if(s.plane==='near')foreground(c,api.kit);
    else if(s.plane==='foothill')foothill(c,api.kit);
    else sideTerrain(c,api.kit,s);
    terrainCache.set(key,layer);
  }
  api.ctx.drawImage(terrainCache.get(key),0,0,540,960);
}

function airPath(api,s,clock) {
  const {ctx:c,kit}=api,m=kit.material;
  const path=s.points,warm=s.warm??false, color=warm?'#efb46b':'#a8d3e6', q=clamp(s.progress??1);
  const reach=.18+.82*q;
  c.save();c.beginPath();
  for(let i=0;i<=32;i++){
    const p=kit.path.cubicPoint(path,reach*i/32);
    if(i===0)c.moveTo(p.x,p.y);else c.lineTo(p.x,p.y);
  }
  c.lineCap='round'; c.lineJoin='round';
  for(let i=28;i>=1;i--){
    const u=i/28;c.lineWidth=(s.width??76)*u;c.strokeStyle=m.rgba(color,.030*(1.42-u));c.stroke();
  }
  c.restore();
  const rng=kit.flow.seeded(219);
  for(let i=0;i<54;i++){
    const v=(clock.time*(.29+rng()*.20)+rng())%1, d=(rng()-.5)*(s.width??76);
    if(v>=reach)continue;
    const p=kit.path.cubicPoint(path,v),p2=kit.path.cubicPoint(path,Math.min(1,v+.01)),a=Math.atan2(p2.y-p.y,p2.x-p.x);
    const fade=smooth(Math.min(v*8,(reach-v)*10));
    if(i<5)kit.path.arrow(c,p.x,p.y,a,32,warm?'#f4c27b':'#d2e9ed',2.6,.91*fade);
    else m.ellipse(c,p.x-Math.sin(a)*d,p.y+Math.cos(a)*d,1.2,1.4,'#f5ecdb',.46*fade);
  }
  const p=kit.path.cubicPoint(path,q);
  if(s.label)callout(api,{...s, dx:s.dx??36,dy:s.dy??-33, x:p.x,y:p.y,text:s.label});
  m.softEllipse(c,p.x,p.y,warm?42:48,warm?32:36,color,.55);
}

function callout(api,s){
  const {ctx:c,kit}=api,m=kit.material;
  const x=s.x??0,y=s.y??0,dx=s.dx??56,dy=s.dy??-28;
  c.save(); c.translate(x,y);
  kit.path.strokePath(c,[[0,0],[dx*.75,dy],[dx,dy]],'#eee8dc',1.1,.85);
  m.ellipse(c,0,0,3.1,3.1,'#f5ead8',.92);
  kit.text.pill(c,s.text,dx,dy-8,{fill:'#22384f',color:'#f4ece0',size:s.size??19,pad:14});
  c.restore();
}
function followChip(api,s){
  const {ctx:c,kit}=api, m=kit.material, q=clamp(s.state??0), done=q>0;
  c.save();
  if(done){
    kit.path.rr(c,-91-13*q,-25-8*q,182+26*q,50+16*q,29);c.strokeStyle=m.rgba(s.accent??'#e5ad68',.48*(1-q));c.lineWidth=1.7;c.stroke();
  }
  kit.path.rr(c,-89,-24,178,48,24);c.fillStyle=done?'#203c50':s.accent??'#e5ad68';c.fill();
  kit.text.lineText(c,'\u2066'+(done?s.after:s.before)+'\u2069',8,{x:0,size:22,color:done?'#f4f2e8':'#193144',align:'center',weight:'bold'});
  c.restore();
}
function airMass(api,s,clock){
  const {ctx:c,kit}=api,m=kit.material,r=s.r??64, color=m.mix('#e5b97f','#9ac2df',clamp(s.cool??0));
  m.softEllipse(c,0,0,r*1.30,r*.97,color,.67);
  m.ellipse(c,0,0,r,r*.70,m.linear(c,-r,-r*.68,r,r*.68,[
    [0,m.rgba('#263d5c',.26)],[.62,m.rgba(color,.34)],[1,m.rgba('#e9e7db',.20)]
  ]));
  c.save();c.beginPath();c.ellipse(0,0,r,r*.70,0,0,turn);
  c.strokeStyle=m.rgba('#f6ebd7',.82);c.lineWidth=1.85;c.stroke();
  c.beginPath();c.ellipse(0,0,r,r*.27,0,0,turn);c.setLineDash([4,6]);
  c.strokeStyle=m.rgba('#f4e8cf',.50);c.lineWidth=1.2;c.stroke();c.restore();
  const rng=kit.flow.seeded(1193);
  for(let i=0;i<26;i++){
    const a=rng()*turn+clock.time*.17,d=Math.sqrt(rng())*r*.83,z=rng();
    m.ellipse(c,Math.cos(a)*d,Math.sin(a)*d*.68,1.3+z*2.2,1.3+z*2.2,'#f9f3e7',.48+z*.31);
  }
  if(s.label)callout(api,{text:s.label,dx:r*.95,dy:-33});
}
const parts={'weather-cloud':weatherCloud,relief,'air-path':airPath,'air-mass':airMass,callout:(api,s)=>callout(api,{...s,x:0,y:0}),'follow-chip':followChip};
module.exports={draw(api,s,clock){
  if(api.plan.project.style_profile==='illustrated-2-5d'){
    const art=api.component('reference-weather');
    if(s.kind==='follow-chip' && s.color_only)return art.follow(api,s);
    if(art.parts[s.kind])return art.parts[s.kind](api,s,clock);
  }
  parts[s.kind](api,s,clock);
}};
