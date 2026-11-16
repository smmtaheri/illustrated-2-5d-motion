#!/usr/bin/env node
'use strict';

/**
 * Deterministic illustrative motion kit. All positions use a 540 × 960 artboard.
 * There is no frame-to-frame random state. createRenderer() loads optional art;
 * renderFrame(seconds) then returns a Canvas synchronously, ready for encoding.
 *
 * Optional assets-manifest.json: {"weatherBackdrop":"sky.png", "cloud":"cloud.png",
 *   "virgaBackdrop":"...", "thermalBackdrop":"...", "transferBackdrop":"..."}
 * Backdrops should contain scenery only, with no labels/arrows/primary subjects.
 * Clouds should be isolated transparent artwork with generous alpha padding.
 *
 * Localized copy may override {title, labels:{groundDry,dryAir,falling,
 * evaporated,risingColumn,metal,wood,warmEnd}, shots:{[shotId]:{heading:[],
 * subtitle,narration,narrationShort,labels:{...}}}}. A shots array is also
 * accepted. Text remains logical Unicode; Canvas handles contextual shaping.
 */

const fs = require('node:fs');
const pathModule = require('node:path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

const PALETTE = Object.freeze({
  ink: '#17273f', deep: '#14253f', midnight: '#102036', sky: '#355d87',
  blue: '#6e97bb', haze: '#aec2d4', horizon: '#edc6a0', ivory: '#f6f4e9',
  amber: '#f3aa49', gold: '#f8c675', coral: '#df8c81', sage: '#839381',
  metal: '#a7bac6', wood: '#a27c58', paper: '#e8e5dc', muted: '#c3d0da',
});
const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, p) => a + (b - a) * p;
const mod = (v, n = 1) => ((v % n) + n) % n;
const smooth = p => { p = clamp(p); return p * p * (3 - 2 * p); };
const smoother = p => { p = clamp(p); return p * p * p * (p * (p * 6 - 15) + 10); };
const easeOut = p => 1 - Math.pow(1 - clamp(p), 3);
const easeInOut = p => p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
const range = (t, a, b) => clamp((t - a) / (b - a));
function seeded(seed = 1) {
  let s = seed >>> 0;
  return () => { s += 0x6d2b79f5; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function rgb(hex) { return hex.replace('#', '').match(/../g).map(v => parseInt(v, 16)); }
function rgba(hex, a) { const c = rgb(hex); return `rgba(${c[0]},${c[1]},${c[2]},${clamp(a)})`; }
function mix(a, b, p) { const aa = rgb(a), bb = rgb(b); return '#' + aa.map((c, i) => Math.round(lerp(c, bb[i], clamp(p))).toString(16).padStart(2, '0')).join(''); }

const fontRuntime=require('./font_runtime.cjs');
const FONT_FILES={
 en:{regular:fontRuntime.file('DejaVuSans.ttf'),bold:fontRuntime.file('DejaVuSans-Bold.ttf')},
 fa:{regular:fontRuntime.coreFile('Motion Persian'),bold:fontRuntime.coreFile('Motion Persian Bold')},
};
function registerFonts(){fontRuntime.core();}
registerFonts();
const TEXT_CONTEXT=new WeakMap();
function typographyFor(language='en',overrides={}) {
  const persian=/^(fa|ar|ur)(-|$)/i.test(language);
  if(persian&&(!fs.existsSync(FONT_FILES.fa.regular)||!fs.existsSync(FONT_FILES.fa.bold)))throw new Error('Persian rendering requires the declared bundled regular and bold fonts.');
  return {
    language,direction:persian?'rtl':'ltr',family:persian?(pathModule.basename(FONT_FILES.fa.regular).startsWith('Vazirmatn')?'Vazirmatn':'Noto Sans Arabic'):'DejaVu Sans',
    regularStack:persian?'"Motion Persian"':'"Motion Sans"',
    boldStack:persian?'"Motion Persian Bold"':'"Motion Sans Bold"',
    regularFile:FONT_FILES[persian?'fa':'en'].regular,boldFile:FONT_FILES[persian?'fa':'en'].bold,
    headingSize:persian?47:47,lineHeight:persian?1.25:1.14,labelScale:persian&&!pathModule.basename(FONT_FILES.fa.regular).startsWith('Vazirmatn')?1.2:1,
    shaping:'Native Canvas contextual shaping of logical Unicode; no manual glyph reversal',...overrides,
  };
}
function configureTextContext(ctx,typography='en') {
  const style=typeof typography==='string'?typographyFor(typography):typography;
  TEXT_CONTEXT.set(ctx,style);ctx.direction=style.direction;ctx.lang=style.language;return style;
}
function fontString(ctx,size,weight='') {
  const style=TEXT_CONTEXT.get(ctx)||typographyFor();ctx.direction=style.direction;ctx.lang=style.language;
  return `${weight?weight+' ':''}${size}px ${weight&&weight!=='normal'?style.boldStack:style.regularStack}`;
}

function linear(ctx, x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [p, color] of stops) g.addColorStop(p, color);
  return g;
}
function radial(ctx, x, y, radius, color, opacity = 1) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, rgba(color, opacity)); g.addColorStop(.48, rgba(color, opacity * .4)); g.addColorStop(1, rgba(color, 0)); return g;
}
function rr(ctx, x, y, w, h, r = 12) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return ctx;
}
function ellipse(ctx, x, y, rx, ry, fill, alpha = 1) {
  ctx.save(); ctx.globalAlpha *= alpha; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fillStyle = fill; ctx.fill(); ctx.restore();
}
function softEllipse(ctx, x, y, rx, ry, color, alpha = .3) {
  ctx.save(); ctx.translate(x, y); ctx.scale(1, ry / rx); ctx.fillStyle = radial(ctx, 0, 0, rx, color, alpha); ctx.fillRect(-rx, -rx, rx * 2, rx * 2); ctx.restore();
}
function paperTexture(w = 540, h = 960, seed = 73) {
  const c = createCanvas(w, h), ctx = c.getContext('2d'), r = seeded(seed), data = ctx.createImageData(w, h);
  for (let i = 0; i < data.data.length; i += 4) { const v = r() > .52 ? 255 : 22; data.data[i] = data.data[i + 1] = data.data[i + 2] = v; data.data[i + 3] = Math.floor(r() * 8); }
  ctx.putImageData(data, 0, 0); return c;
}
function applyGrain(ctx, texture, alpha = .42) {
  ctx.save(); ctx.globalAlpha *= alpha; ctx.globalCompositeOperation = 'soft-light'; ctx.drawImage(texture, 0, 0, 540, 960); ctx.restore();
}
function lightRays(ctx,{x=285,y=815,opacity=.5}={}) {
  ctx.save();ctx.globalCompositeOperation='screen';ctx.filter='blur(9px)';
  for(const [angle,spread,alpha]of [[-1.96,.018,.06],[-1.77,.028,.08],[-1.59,.041,.06],[-1.37,.034,.065],[-1.13,.022,.055]]){
    const distance=600,g=linear(ctx,x,y,x+Math.cos(angle)*distance,y+Math.sin(angle)*distance,[[0,rgba(PALETTE.horizon,0)],[.27,rgba('#fff0ce',alpha*opacity)],[.72,rgba('#eef5fa',alpha*opacity*.45)],[1,rgba('#eef5fa',0)]]);
    polygon(ctx,[[x-10,y],[x+Math.cos(angle-spread)*distance,y+Math.sin(angle-spread)*distance],[x+Math.cos(angle+spread)*distance,y+Math.sin(angle+spread)*distance],[x+10,y]],g);
  }ctx.restore();
}
function vignette(ctx, alpha = .13) {
  const g = ctx.createRadialGradient(270, 490, 220, 270, 490, 650);
  g.addColorStop(0, rgba(PALETTE.deep, 0)); g.addColorStop(1, rgba(PALETTE.deep, alpha)); ctx.fillStyle = g; ctx.fillRect(0, 0, 540, 960);
}
function polygon(ctx, pts, fill, stroke = null, width = 1) {
  ctx.__recordDraw?.('path.polygon');
  ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
}
function cubicPoint(p, t) {
  const q = 1 - t;
  return { x: q*q*q*p[0][0] + 3*q*q*t*p[1][0] + 3*q*t*t*p[2][0] + t*t*t*p[3][0], y: q*q*q*p[0][1] + 3*q*q*t*p[1][1] + 3*q*t*t*p[2][1] + t*t*t*p[3][1] };
}
function cubicTangent(p, t) {
  const q = 1 - t;
  return {x: 3*q*q*(p[1][0]-p[0][0])+6*q*t*(p[2][0]-p[1][0])+3*t*t*(p[3][0]-p[2][0]), y: 3*q*q*(p[1][1]-p[0][1])+6*q*t*(p[2][1]-p[1][1])+3*t*t*(p[3][1]-p[2][1])};
}
function strokePath(ctx, points, color, width = 2, alpha = 1, dash = []) {
  ctx.__recordDraw?.('path.strokePath');
  ctx.save(); ctx.globalAlpha *= alpha; ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.setLineDash(dash); ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); ctx.restore();
}
function curve(ctx, p, color, width = 2, alpha = 1, dash = []) {
  ctx.__recordDraw?.('path.curve');
  ctx.save(); ctx.globalAlpha *= alpha; ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.setLineDash(dash); ctx.beginPath(); ctx.moveTo(...p[0]); ctx.bezierCurveTo(...p[1], ...p[2], ...p[3]); ctx.stroke(); ctx.restore();
}
function arrow(ctx, x, y, angle, length = 30, color = PALETTE.amber, width = 4, alpha = 1) {
  ctx.__recordDraw?.('path.arrow');
  ctx.save(); ctx.globalAlpha *= alpha; ctx.translate(x, y); ctx.rotate(angle); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = width;
  ctx.beginPath(); ctx.moveTo(-length / 2, 0); ctx.lineTo(length / 2 - 4, 0); ctx.stroke(); ctx.beginPath(); ctx.moveTo(length/2, 0); ctx.lineTo(length/2-9, -6); ctx.lineTo(length/2-9, 6); ctx.closePath(); ctx.fill(); ctx.restore();
}
function flowMarkers(ctx, p, time, { count = 3, period = 2.5, color = PALETTE.gold, size = 23, width = 3, alpha = .7, offset = 0 } = {}) {
  for (let i = 0; i < count; i++) { const q = mod(time / period + i / count + offset), xy = cubicPoint(p, q), tan = cubicTangent(p, q), fade = Math.min(1, q*10, (1-q)*10); arrow(ctx, xy.x, xy.y, Math.atan2(tan.y, tan.x), size, color, width, alpha*fade); }
}
function drawCover(ctx, image, x = 0, y = 0, w = 540, h = 960) {
  const scale = Math.max(w / image.width, h / image.height), sw = w / scale, sh = h / scale;
  ctx.drawImage(image, (image.width-sw)/2, (image.height-sh)/2, sw, sh, x, y, w, h);
}

function lineText(ctx, words, y, { size = 38, color = PALETTE.ivory, align = 'center', x = 270, maxWidth = 470, weight = 'bold' } = {}) {
  ctx.__recordDraw?.('text.lineText');
  ctx.font = fontString(ctx,size,weight);
  let measured = ctx.measureText(words).width;
  if (measured > maxWidth) { size *= maxWidth / measured; ctx.font = fontString(ctx,size,weight); measured = maxWidth; }
  const metrics=ctx.measureText(words);
  ctx.textAlign = align; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = color; ctx.fillText(words, x, y); return { width: measured, size,descent:metrics.actualBoundingBoxDescent||0 };
}
function heading(ctx, { lines, highlight = 1, subtitle = '', y = 124, size = 37, underline = true, time = 1, subtitleGap = null, profile = 'legacy' }) {
  ctx.__recordDraw?.('text.heading');
  const calibrated=profile==='calibrated',alpha = calibrated?(time<2/30?0:1):smooth(range(time, 0, .16));
  const type=TEXT_CONTEXT.get(ctx)||typographyFor(),lineHeight=type.lineHeight;
  ctx.save(); ctx.globalAlpha *= alpha;
  if(calibrated){
    const q=range(time,2/30,8/30),scale=1+.32*Math.pow(1-q,3);
    ctx.translate(270,y+12);ctx.scale(scale,scale);ctx.translate(-270,-y-12);
    const blur=2.5*(1-q);ctx.filter=blur<.01?'none':`blur(${blur}px)`;ctx.shadowColor='rgba(16,31,48,.29)';ctx.shadowBlur=4;ctx.shadowOffsetY=2;
  }
  let highlightMetrics;
  if(alpha>0)lines.forEach((line, i) => { const yy = y + i*(size*lineHeight); const m = lineText(ctx, line, yy, {size, color:i===highlight?PALETTE.gold:PALETTE.ivory}); if(i===highlight) highlightMetrics={...m,y:yy}; });
  ctx.restore();
  if (underline && highlightMetrics) { const m=highlightMetrics,offset=type.direction==='rtl'?Math.max(12,m.descent+7):(calibrated?5:9);ctx.save();
    if(calibrated){const reveal=easeOut(range(time,.25,.45));ctx.fillStyle=linear(ctx,270-m.width/2,0,270+m.width/2,0,[[0,PALETTE.gold],[1,'#cd842d']]);ctx.fillRect(270-m.width/2,m.y+offset,m.width*reveal,6);}
    else strokePath(ctx, [[270-m.width/2,m.y+offset],[270+m.width/2,m.y+offset]], PALETTE.amber, 3, .85*alpha);
    ctx.restore();
  }
  const subtitleAlpha=calibrated?smooth(range(time,.15,.35)):alpha;
  if (subtitle&&subtitleAlpha>0) { const yy=subtitleGap===null?y+lines.length*size*lineHeight+17:y+(lines.length-1)*size*lineHeight+subtitleGap;ctx.save();ctx.globalAlpha*=subtitleAlpha;ctx.shadowColor=rgba('#132335',.24*ctx.globalAlpha);ctx.shadowBlur=3;ctx.shadowOffsetY=1;lineText(ctx,subtitle,yy,{size:type.direction==='rtl'?23:(calibrated?25:22),color:rgba(PALETTE.ivory,.96),weight:calibrated?'bold':'normal',maxWidth:456});ctx.restore(); }
}
function label(ctx, words, x, y, {color=PALETTE.ivory,size=14,align='left',alpha=1}={}) {
  if(ctx.globalAlpha*alpha<.001)return;
  ctx.__recordDraw?.('text.label');
  const type=TEXT_CONTEXT.get(ctx)||typographyFor();ctx.save();ctx.globalAlpha*=alpha;ctx.font=fontString(ctx,size*type.labelScale,'bold');ctx.textAlign=align;ctx.textBaseline='alphabetic';ctx.fillStyle=color;ctx.shadowColor=rgba('#112639',.27*ctx.globalAlpha);ctx.shadowBlur=2;ctx.shadowOffsetY=1;ctx.fillText(words,x,y);ctx.restore();
}
function pill(ctx, words, x, y, {fill=PALETTE.amber,color=PALETTE.deep,size=12,pad=10}={}) {
  if(!words)return 0;const type=TEXT_CONTEXT.get(ctx)||typographyFor();ctx.save();ctx.font=fontString(ctx,size*type.labelScale,'bold');const w=ctx.measureText(words).width+pad*2;rr(ctx,x-w/2,y-19,w,28,14);ctx.fillStyle=fill;ctx.fill();ctx.textAlign='center';ctx.fillStyle=color;ctx.fillText(words,x,y);ctx.restore();return w;
}

function skyBackground({ warmth = 1, ridges = true, seed = 11 } = {}) {
  const c=createCanvas(540,960),ctx=c.getContext('2d');
  ctx.fillStyle=linear(ctx,0,0,0,960,[[0,'#22446f'],[.30,'#436f9b'],[.58,'#9bb7cd'],[.79,warmth?'#edc6a0':'#a9c0cb'],[1,'#d0baa0']]);ctx.fillRect(0,0,540,960);
  softEllipse(ctx,267,754,330,260,PALETTE.horizon,.49*warmth);
  // Broad low-contrast light shafts, rather than particles disguising still art.
  ctx.save();ctx.globalCompositeOperation='screen';
  for(const [a,w,op] of [[-1.90,.035,.08],[-1.74,.046,.09],[-1.58,.075,.075],[-1.37,.055,.07],[-1.15,.035,.055]]) {
    const ox=285,oy=825,dist=680;const grad=linear(ctx,ox,oy,ox+Math.cos(a)*dist,oy+Math.sin(a)*dist,[[0,rgba(PALETTE.horizon,0)],[.30,rgba('#fff4cf',op)],[1,rgba('#e7eff7',0)]]);
    polygon(ctx,[[ox-20,oy],[ox+Math.cos(a-w)*dist,oy+Math.sin(a-w)*dist],[ox+Math.cos(a+w)*dist,oy+Math.sin(a+w)*dist],[ox+25,oy]],grad);
  }ctx.restore();
  if(ridges) drawRidges(ctx);
  applyGrain(ctx,paperTexture(540,960,seed),.45);vignette(ctx,.10);return c;
}
function drawRidges(ctx) {
  // Each plane is an organic silhouette with its own haze and value range.
  ctx.beginPath();ctx.moveTo(0,760);ctx.bezierCurveTo(35,733,55,750,84,729);ctx.lineTo(121,691);ctx.lineTo(144,710);ctx.lineTo(166,700);ctx.lineTo(216,756);ctx.bezierCurveTo(250,768,271,755,289,734);ctx.lineTo(323,701);ctx.lineTo(350,722);ctx.lineTo(378,706);ctx.bezierCurveTo(430,754,471,748,540,761);ctx.lineTo(540,960);ctx.lineTo(0,960);ctx.closePath();ctx.fillStyle='#acb8c4';ctx.fill();
  ctx.beginPath();ctx.moveTo(0,792);ctx.bezierCurveTo(90,768,130,790,185,798);ctx.bezierCurveTo(260,816,297,760,350,774);ctx.bezierCurveTo(421,784,446,792,540,777);ctx.lineTo(540,960);ctx.lineTo(0,960);ctx.closePath();ctx.fillStyle='#7f96b0';ctx.fill();
  ctx.beginPath();ctx.moveTo(0,817);ctx.bezierCurveTo(80,802,128,833,202,824);ctx.bezierCurveTo(256,817,297,841,340,814);ctx.bezierCurveTo(382,791,396,755,433,743);ctx.bezierCurveTo(470,731,495,778,540,805);ctx.lineTo(540,960);ctx.lineTo(0,960);ctx.closePath();ctx.fillStyle=linear(ctx,0,740,0,960,[[0,'#3b5979'],[1,'#283e58']]);ctx.fill();
  ctx.beginPath();ctx.moveTo(0,881);ctx.bezierCurveTo(99,855,123,886,214,864);ctx.bezierCurveTo(321,837,381,856,540,838);ctx.lineTo(540,960);ctx.lineTo(0,960);ctx.closePath();ctx.fillStyle=linear(ctx,0,830,0,960,[[0,'#273e56'],[1,'#1b2d43']]);ctx.fill();
  // Ground brush lines are shaped, subtle, and fixed in world coordinates.
  const r=seeded(77);for(let i=0;i<29;i++){const x=r()*540,y=881+r()*73;strokePath(ctx,[[x,y],[x+8+r()*21,y-2+r()*4]],'#91a6b5',.6,.09);}
}
function cloudSilhouette(ctx) {
  ctx.beginPath();ctx.moveTo(-.48,.19);ctx.bezierCurveTo(-.55,.09,-.52,-.02,-.41,-.025);ctx.bezierCurveTo(-.45,-.17,-.31,-.27,-.20,-.20);ctx.bezierCurveTo(-.20,-.40,-.04,-.46,.075,-.34);ctx.bezierCurveTo(.12,-.45,.30,-.36,.29,-.20);ctx.bezierCurveTo(.43,-.24,.48,-.13,.45,-.035);ctx.bezierCurveTo(.57,-.01,.56,.16,.47,.205);ctx.bezierCurveTo(.31,.24,.17,.21,.02,.235);ctx.bezierCurveTo(-.17,.23,-.32,.245,-.48,.19);ctx.closePath();
}
function makeCloud({storm=false,seed=29}={}) {
  const c=createCanvas(700,330),ctx=c.getContext('2d');ctx.translate(350,188);ctx.scale(600,420);
  cloudSilhouette(ctx);ctx.save();ctx.clip();ctx.fillStyle=linear(ctx,0,-.42,0,.26,[[0,storm?'#d8dbe3':'#faf5e8'],[.50,storm?'#a6b5ca':'#e9e7e2'],[.81,storm?'#667e9e':'#c9c5d5'],[1,storm?'#62748e':'#b1aec2']]);ctx.fillRect(-.6,-.5,1.2,.9);
  const lobes=[[-.29,-.10,.20,.17],[-.06,-.22,.24,.20],[.17,-.12,.22,.19],[.35,.035,.16,.13],[-.41,.07,.14,.11],[.00,.085,.24,.12]];
  for(const [x,y,rx,ry]of lobes){softEllipse(ctx,x-.025,y-.035,rx,ry,storm?'#e8e5e3':'#fff9ef',storm?.26:.34);softEllipse(ctx,x+.055,y+.12,rx,.05,storm?'#445d80':'#9993ae',.16);}
  ctx.restore();ctx.setTransform(1,0,0,1,0,0);ctx.save();ctx.globalCompositeOperation='source-atop';ctx.globalAlpha=.30;ctx.drawImage(paperTexture(700,330,seed),0,0);ctx.restore();return c;
}
function drawCloud(ctx, image, x, y, w, {opacity=1, sway=0}={}) {
  ctx.save();ctx.globalAlpha*=opacity;const h=w*image.height/image.width;ctx.drawImage(image,x-w/2+sway,y-h/2,w,h);ctx.restore();
}
function droplet(ctx,x,y,r,{alpha=1,color='#c5dbe8',stretch=1.3}={}) {
  ctx.__recordDraw?.('material.droplet');
  if(r<.18||alpha<=0)return;ctx.save();ctx.translate(x,y);ctx.globalAlpha*=alpha;
  ctx.beginPath();ctx.moveTo(0,-r*stretch);ctx.bezierCurveTo(r*.35,-r*.55,r*.78,-r*.15,r*.72,r*.38);ctx.bezierCurveTo(r*.65,r*1.04,-r*.65,r*1.04,-r*.72,r*.38);ctx.bezierCurveTo(-r*.78,-r*.15,-r*.35,-r*.55,0,-r*stretch);ctx.closePath();
  ctx.fillStyle=linear(ctx,-r,-r,r,r,[[0,mix(color,'#ffffff',.25)],[.45,color],[1,mix(color,PALETTE.blue,.43)]]);ctx.fill();
  ctx.save();ctx.clip();softEllipse(ctx,-r*.24,-r*.20,r*.55,r*.95,'#e8f1f2',.16);ctx.restore();ctx.restore();
}
function rainCurtain(ctx,t,{x=270,top=435,bottom=747,width=306,count=60,seed=97}={}) {
  ctx.__recordDraw?.('flow.rainCurtain');
  const r=seeded(seed);
  for(let i=0;i<count;i++){
    const x0=x+(r()-.5)*width, phase=r(),life=1.20+r()*.70, sz=1.8+r()*1.6;
    const q=mod(t/life+phase), fadeIn=smooth(q*11), evaporate=1-smooth(range(q,.36,.94)), yy=lerp(top,bottom,q),xx=x0+10*q;
    const opacity=(.65+r()*.25)*fadeIn*evaporate;
    if(q<.78){strokePath(ctx,[[xx,yy-5*evaporate],[xx+1,yy+7*evaporate]],'#e2edf4',sz*.61,opacity);droplet(ctx,xx+1,yy+7*evaporate,sz*evaporate,{alpha:opacity*.88,stretch:1.1});}
  }
}
function warmParcel(ctx,x,y,r,p=0,alpha=1) {
  const col=mix(PALETTE.amber,'#98bacd',p);
  ctx.save();ctx.globalAlpha*=alpha;
  softEllipse(ctx,x,y,r*1.65,r*1.25,col,.15);
  ctx.beginPath();ctx.moveTo(x-r,y+3);ctx.bezierCurveTo(x-r*1.05,y-r*.63,x-r*.36,y-r*.98,x+r*.10,y-r*.86);ctx.bezierCurveTo(x+r*.82,y-r*.84,x+r*1.08,y-r*.21,x+r*.93,y+r*.28);ctx.bezierCurveTo(x+r*.70,y+r*.95,x-r*.59,y+r*.98,x-r,y+3);ctx.closePath();
  const volume=ctx.createRadialGradient(x-r*.35,y-r*.43,r*.06,x+r*.15,y+r*.19,r*1.35);
  volume.addColorStop(0,mix(col,PALETTE.ivory,.27));volume.addColorStop(.40,col);volume.addColorStop(.77,mix(col,PALETTE.deep,.12));volume.addColorStop(1,mix(col,PALETTE.deep,.26));
  ctx.fillStyle=volume;ctx.fill();ctx.strokeStyle=rgba(mix(col,PALETTE.ivory,.6),.23);ctx.lineWidth=1.1;ctx.stroke();
  // A small, softened upper-left glint follows the reference parcel's finish;
  // the broad value shift supplies volume without a glassy or metallic surface.
  softEllipse(ctx,x-r*.30,y-r*.34,r*.24,r*.14,PALETTE.ivory,.58);
  ctx.save();ctx.translate(x-r*.31,y-r*.35);ctx.rotate(-.28);ellipse(ctx,0,0,r*.12,r*.055,PALETTE.ivory,.29);ctx.restore();ctx.restore();
}
function panel(ctx,x,y,w,h,{radius=18,alpha=.92}={}) {
  ctx.save();ctx.shadowColor=rgba(PALETTE.midnight,.18);ctx.shadowBlur=20;ctx.shadowOffsetY=12;rr(ctx,x,y,w,h,radius);ctx.fillStyle=linear(ctx,x,y,x+w,y+h,[[0,rgba('#203750',alpha)],[1,rgba('#13253c',alpha)]]);ctx.fill();ctx.shadowColor='transparent';rr(ctx,x+.5,y+.5,w-1,h-1,radius);ctx.strokeStyle=rgba(PALETTE.haze,.12);ctx.lineWidth=1;ctx.stroke();ctx.restore();
}
function glowBand(ctx,x,y,w,h,color=PALETTE.amber,alpha=.25) {
  ctx.save();ctx.fillStyle=linear(ctx,x,y,x+w,y,[[0,rgba(color,0)],[.35,rgba(color,alpha)],[.65,rgba(color,alpha)],[1,rgba(color,0)]]);ctx.fillRect(x,y,w,h);ctx.restore();
}
const COLUMN_CACHE=new Map();
function softColumn(ctx,x,top,bottom,{width=160,color=PALETTE.amber,alpha=.22}={}) {
  // Composite one continuous alpha field. Overlapping translucent horizontal
  // strips create visible five-pixel seams after encoding, so never tile them.
  const w=Math.ceil(width*1.45),h=Math.ceil(bottom-top),key=[w,h,color,alpha].join(':');
  let field=COLUMN_CACHE.get(key);
  if(!field){
    field=createCanvas(w,h);const q=field.getContext('2d'),pixels=q.createImageData(w,h),[red,green,blue]=rgb(color);
    for(let y=0;y<h;y++){
      const p=(y+.5)/h,r=width*(.42+.10*Math.sin(p*Math.PI)),fade=smooth(p*5)*(1-smooth(range(p,.88,1)));
      for(let xx=0;xx<w;xx++){
        const nx=Math.abs(xx+.5-w/2)/r,edge=1-smooth(range(nx,.08,1)),i=(y*w+xx)*4;
        pixels.data[i]=red;pixels.data[i+1]=green;pixels.data[i+2]=blue;pixels.data[i+3]=Math.round(255*alpha*fade*edge);
      }
    }
    q.putImageData(pixels,0,0);COLUMN_CACHE.set(key,field);
  }
  ctx.drawImage(field,x-w/2,top);
}
function warmPatch(ctx,x,y,w=170,h=31) {
  softEllipse(ctx,x,y,w*.75,h*2,PALETTE.amber,.27);
  ctx.beginPath();ctx.moveTo(x-w*.5,y-h*.25);ctx.bezierCurveTo(x-w*.35,y-h*.45,x+w*.22,y-h*.5,x+w*.47,y-h*.20);ctx.lineTo(x+w*.52,y+h*.5);ctx.bezierCurveTo(x+w*.20,y+h*.68,x-w*.20,y+h*.72,x-w*.55,y+h*.46);ctx.closePath();ctx.fillStyle=linear(ctx,x,y-h,x,y+h,[[0,'#d9aa66'],[.55,'#b5874c'],[1,'#6e543c']]);ctx.fill();
  for(let i=0;i<7;i++)strokePath(ctx,[[x-w*.44,y-h*.16+i*3],[x+w*.42,y-h*.25+i*3]],'#e6b66e',.7,.18);
}

function roomBackground(materialImage=null) {
  const c=createCanvas(540,960),ctx=c.getContext('2d');
  ctx.fillStyle=linear(ctx,0,0,540,880,[[0,'#203b56'],[.52,'#36546b'],[1,'#75818a']]);ctx.fillRect(0,0,540,960);
  if(materialImage)drawCover(ctx,materialImage);
  // Light belongs to the interior: a warm wall lamp and broad falloff.
  softEllipse(ctx,434,493,212,280,'#e7c698',.16);
  strokePath(ctx,[[466,294],[466,398]],'#1c3147',10,.9);
  ctx.beginPath();ctx.moveTo(424,377);ctx.quadraticCurveTo(463,341,496,377);ctx.lineTo(511,417);ctx.quadraticCurveTo(469,434,409,416);ctx.closePath();ctx.fillStyle=linear(ctx,408,360,510,434,[[0,'#667b85'],[.65,'#3e5768'],[1,'#284354']]);ctx.fill();
  ellipse(ctx,460,418,50,8,'#dfc398',.55);
  ctx.beginPath();ctx.moveTo(420,426);ctx.lineTo(343,751);ctx.lineTo(540,751);ctx.lineTo(500,426);ctx.closePath();ctx.fillStyle=linear(ctx,0,420,0,755,[[0,rgba('#f8d397',.055)],[1,rgba('#f8d397',0)]]);ctx.fill();
  // Two quiet framed shapes and a shelf establish an illustrated room.
  rr(ctx,47,332,112,152,5);ctx.fillStyle='#293f50';ctx.fill();rr(ctx,54,339,98,138,2);ctx.fillStyle='#89999d';ctx.fill();
  ctx.save();rr(ctx,59,344,88,128,1);ctx.clip();ctx.fillStyle='#b6b7a8';ctx.fillRect(59,344,88,128);
  // An abstract vessel print, with no sky, landscape, or weather motif.
  ctx.beginPath();ctx.moveTo(74,380);ctx.lineTo(94,380);ctx.bezierCurveTo(91,400,107,410,101,444);ctx.quadraticCurveTo(84,455,67,442);ctx.bezierCurveTo(62,417,79,405,74,380);ctx.closePath();ctx.fillStyle='#526f74';ctx.fill();
  ctx.beginPath();ctx.moveTo(113,397);ctx.lineTo(129,397);ctx.lineTo(134,449);ctx.quadraticCurveTo(121,458,108,449);ctx.closePath();ctx.fillStyle='#b18e6b';ctx.fill();ctx.restore();
  ctx.fillStyle='#263f51';ctx.fillRect(19,568,164,10);ctx.fillStyle='#b2aaa0';rr(ctx,47,526,29,42,4);ctx.fill();ctx.fillStyle='#637a75';rr(ctx,83,511,16,57,2);ctx.fill();ctx.fillStyle='#b49473';rr(ctx,104,520,21,48,2);ctx.fill();
  ctx.beginPath();ctx.moveTo(0,744);ctx.lineTo(540,744);ctx.lineTo(540,960);ctx.lineTo(0,960);ctx.closePath();ctx.fillStyle=linear(ctx,0,744,0,960,[[0,'#aa8f76'],[.12,'#9d7e64'],[1,'#705643']]);ctx.fill();
  ctx.fillStyle='#c0a389';ctx.fillRect(0,744,540,6);
  const r=seeded(266);for(let i=0;i<40;i++){const y=763+r()*190;curve(ctx,[[0,y],[150,y-6+r()*11],[390,y-10+r()*20],[540,y+2]],'#513e31',.6,.1);}
  applyGrain(ctx,paperTexture(),.45);vignette(ctx,.16);return c;
}
function spoon(ctx,x,y,{wood=false,angle=0,hot=0,scale=1}={}) {
  ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.scale(scale,scale);
  // A long handle, shallow neck, and hand-shaped bowl rather than a bare bar.
  const outline=()=>{ctx.beginPath();ctx.moveTo(-10,-146);ctx.bezierCurveTo(-10,-163,10,-163,10,-146);ctx.lineTo(8,31);ctx.bezierCurveTo(10,46,32,53,29,79);ctx.bezierCurveTo(28,112,-29,111,-29,80);ctx.bezierCurveTo(-32,53,-10,44,-8,31);ctx.closePath();};outline();
  const base=wood?'#b4906b':'#9caeb6';
  ctx.fillStyle=linear(ctx,-29,0,29,0,wood?[[0,'#5c4e3e'],[.4,'#998369'],[1,'#756049']]:[[0,'#6e8795'],[.38,'#c1ccd0'],[.75,'#a2b1b8'],[1,'#6e8492']]);ctx.fill();
  ctx.save();ctx.clip();if(hot>0){ctx.fillStyle=linear(ctx,0,101,0,-160,[[0,rgba(PALETTE.amber,.78)],[clamp(.1+hot*.7),rgba(PALETTE.amber,.45)],[clamp(.22+hot*.7),rgba(PALETTE.amber,0)],[1,rgba(PALETTE.amber,0)]]);ctx.fillRect(-40,-170,80,290);}
  if(wood){for(let i=0;i<4;i++)curve(ctx,[[-6+i*4,-148],[-9+i*4,-65],[-7+i*4,11],[-17+i*10,91]],'#75523d',.8,.22);}
  else{strokePath(ctx,[[-5,-143],[-4,28]],'#edf0ec',1,.37);ellipse(ctx,-4,73,15,22,'#526f7e',.28);}
  if(hot>.035)arrow(ctx,0,lerp(16,-116,hot),-Math.PI/2,18,PALETTE.deep,1.8,.56);
  ctx.restore();outline();ctx.strokeStyle=rgba(wood?'#5b4739':'#3d596b',.35);ctx.lineWidth=1.3;ctx.stroke();ctx.restore();
}
function basin(ctx,x=270,y=759) {
  softEllipse(ctx,x,y+61,161,30,PALETTE.deep,.27);
  ctx.beginPath();ctx.moveTo(x-141,y);ctx.bezierCurveTo(x-132,y+114,x+133,y+114,x+141,y);ctx.closePath();ctx.fillStyle=linear(ctx,x-140,y,x+140,y+93,[[0,'#67838f'],[.48,'#9bb0b5'],[1,'#4d6e80']]);ctx.fill();
  ellipse(ctx,x,y,141,34,'#a7b6b7');ellipse(ctx,x,y,130,26,'#476879');ellipse(ctx,x,y+2,122,21,linear(ctx,x,y-20,x,y+24,[[0,'#b39569'],[1,'#cfaf78']]));
  curve(ctx,[[x-118,y+2],[x-46,y-21],[x+62,y-18],[x+117,y+5]],'#f1d7aa',1,.36);
}
function materialBar(ctx,x,y,w,h,{wood=false,progress=.5}={}) {
  ctx.save();ctx.shadowColor=rgba(PALETTE.midnight,.3);ctx.shadowBlur=12;ctx.shadowOffsetY=10;
  rr(ctx,x,y,w,h,9);ctx.fillStyle=linear(ctx,x,y,x,y+h,wood?[[0,'#99856c'],[.45,'#78654e'],[1,'#554a3b']]:[[0,'#bed0d7'],[.44,'#8ea6b4'],[1,'#5d788c']]);ctx.fill();ctx.shadowColor='transparent';ctx.save();rr(ctx,x,y,w,h,9);ctx.clip();
  const stop=clamp(progress);
  ctx.fillStyle=linear(ctx,x,y,x+w,y,[[0,rgba(PALETTE.amber,.94)],[Math.max(.001,stop*.73),rgba(PALETTE.amber,.72)],[Math.max(.002,stop),rgba(PALETTE.amber,.04)],[1,rgba(PALETTE.amber,0)]]);ctx.fillRect(x,y,w,h);
  if(wood){for(let i=0;i<6;i++)curve(ctx,[[x,y+6+i*6],[x+w*.35,y+2+i*6],[x+w*.6,y+11+i*6],[x+w,y+5+i*6]],'#684c38',.8,.24);}else strokePath(ctx,[[x+15,y+8],[x+w-15,y+8]],'#eff2ee',1,.28);
  ctx.restore();ctx.strokeStyle=rgba(PALETTE.ivory,.14);ctx.lineWidth=.8;rr(ctx,x+.5,y+.5,w-1,h-1,9);ctx.stroke();ctx.restore();
}

const CASES = Object.freeze({
  virga: {
    title:'Rain that evaporates before reaching the ground',
    shots:[
      {id:'virga-context',fraction:[0,.525],view:'context',heading:['RAIN ABOVE.','DRY BELOW.'],highlight:1,subtitle:'Virga',meaning:'Rain falls from a cloud and diminishes well above the ground.',primary:'Staggered narrow drops fall and shrink within their own lifetimes; the terrain and cloud are independent.',secondary:'A slight cloud-edge drift; no gas particles or visible vapor.',camera:'locked',narration:'Rain can evaporate before it reaches the ground.'},
      {id:'virga-section',fraction:[.525,1],view:'macro section',heading:['DROPS','SHRINK AWAY.'],highlight:1,subtitle:'Evaporating in dry air',meaning:'A magnified section makes the change in droplet size explicit.',primary:'Separate matte drops travel downward, shrink continuously, then disappear inside the dry-air region.',secondary:'A sparse guide path fixes the upper and lower regions.',camera:'locked',narration:'In dry air, falling drops become smaller until they disappear.'},
    ],
  },
  thermal: {
    title:'Warm air rises and surrounding air moves inward',
    shots:[
      {id:'thermal-section',fraction:[0,.525],view:'vertical section in context',heading:['WARM AIR','RISES.'],highlight:1,subtitle:'A rising thermal',meaning:'A distinct parcel is lifted above a warm patch and changes state as it rises.',primary:'A matte warm parcel rises, gently expands, and shifts toward a cooler blue using the same progress value.',secondary:'Upward flow markers and two delayed smaller parcels support the direction.',camera:'locked',narration:'Air warmed near the ground rises in a thermal.'},
      {id:'thermal-plan',fraction:[.525,1],view:'top-down',heading:['AIR MOVES','INWARD.'],highlight:1,subtitle:'View from above',meaning:'The view changes to reveal air converging around the rising column.',primary:'Four curved routes carry distinct arrows and tracers from the surroundings toward the warm central region.',secondary:'A soft central contour subtly expands while the ground stays fixed.',camera:'locked',narration:'Surrounding air moves toward the rising column.'},
    ],
  },
  transfer: {
    title:'Metal and wood conduct heat differently',
    shots:[
      {id:'transfer-context',fraction:[0,.525],view:'indoor context',heading:['SAME WARMTH.','DIFFERENT REACH.'],highlight:1,subtitle:'Metal and wood',meaning:'Two spoons share a warm source, but the warmth advances differently along their handles.',primary:'Two independently advancing amber fronts travel from the immersed bowls along the handles at different rates.',secondary:'A stable tabletop, basin, and wall lamp supply coherent indoor depth.',camera:'locked',narration:'Metal and wood respond differently to the same warm source.'},
      {id:'transfer-comparison',fraction:[.525,1],view:'material comparison close-up',heading:['HEAT TRAVELS','MORE READILY.'],highlight:1,subtitle:'Through metal',meaning:'A paired close-up makes the conduction comparison readable.',primary:'Two heat fronts move through clearly labelled metal and wood bars; metal advances farther in the same illustration interval.',secondary:'Warm-end coupling and sparse internal arrows reveal a shared boundary.',camera:'locked',narration:'Heat travels more readily through metal than through wood.'},
    ],
  },
});

const LABELS={
  en:{groundDry:'GROUND STAYS DRY',dryAir:'DRY AIR',falling:'FALLING',evaporated:'EVAPORATED',risingColumn:'RISING COLUMN',metal:'METAL',wood:'WOOD',warmEnd:'WARM END'},
  fa:{groundDry:'زمین خشک می‌ماند',dryAir:'هوای خشک',falling:'سقوط',evaporated:'تبخیر شد',risingColumn:'ستون صعودی',metal:'فلز',wood:'چوب',warmEnd:'سرِ گرم'},
};
const SHORT_NARRATION={virga:['Rain falls.','Dry air shrinks the drops.'],thermal:['Warm air rises.','Air moves inward.'],transfer:['Same warm source.','Metal conducts heat more readily.']};
const PERSIAN_COPY={
  virga:{title:'بارانی که پیش از رسیدن به زمین تبخیر می‌شود',shots:[
    {heading:['بالا باران می‌بارد','پایین خشک می‌ماند'],subtitle:'ویرگا',narration:'گاهی باران پیش از رسیدن به زمین تبخیر می‌شود.',narrationShort:'باران می‌بارد.'},
    {heading:['قطره‌ها','تبخیر می‌شوند'],subtitle:'تبخیر در هوای خشک',narration:'قطره‌های باران در هوای خشک کوچک و سپس ناپدید می‌شوند.',narrationShort:'قطره‌ها تبخیر می‌شوند.'},
  ]},
  thermal:{title:'هوای گرم بالا می‌رود و هوای اطراف به درون می‌آید',shots:[
    {heading:['هوای گرم','بالا می‌رود'],subtitle:'جریان صعودی هوا',narration:'هوایی که نزدیک زمین گرم شده است، بالا می‌رود.',narrationShort:'هوای گرم بالا می‌رود.'},
    {heading:['هوای اطراف','به درون می‌آید'],subtitle:'نمای بالا',narration:'هوای اطراف به سوی ستون صعودی حرکت می‌کند.',narrationShort:'هوا به درون می‌آید.'},
  ]},
  transfer:{title:'فلز و چوب گرما را یکسان منتقل نمی‌کنند',shots:[
    {heading:['گرمای یکسان','انتقال متفاوت'],subtitle:'فلز و چوب',narration:'فلز و چوب در برابر یک منبع گرم، رفتار متفاوتی دارند.',narrationShort:'یک منبع گرم.'},
    {heading:['گرما در فلز','آسان‌تر پیش می‌رود'],subtitle:'در مقایسه با چوب',narration:'فلز گرما را آسان‌تر از چوب منتقل می‌کند.',narrationShort:'فلز گرما را بهتر منتقل می‌کند.'},
  ]},
};
function resolveProjectCopy(caseName,language='en',override={}) {
  if(!['en','fa'].includes(language))throw new Error('Language must be en or fa. Use copy overrides for project wording.');
  if(!CASES[caseName])throw new Error(`Unknown case ${caseName}. Choose virga, thermal, or transfer.`);
  if(!override||typeof override!=='object'||Array.isArray(override))throw new Error('copy must be a project copy object.');
  const custom=override.cases?.[caseName]||override[caseName]||override,localized=language==='fa'?PERSIAN_COPY[caseName]:{},base=CASES[caseName];
  const labels={...LABELS[language],...(custom.labels||{})};
  const shots=base.shots.map((shot,index)=>{
    const local=localized.shots?.[index]||{},entries=custom.shots||{},change=Array.isArray(entries)?(entries.find(s=>s?.id===shot.id)||entries[index]||{}):(entries[shot.id]||entries[index]||{});
    const resolved={...shot,narrationShort:SHORT_NARRATION[caseName][index],...local,...change,labels:{...labels,...(local.labels||{}),...(change.labels||{})}};
    if(change.narration!==undefined&&change.narrationShort===undefined)resolved.narrationShort=change.narration;
    if(change.narrationShort!==undefined&&change.narration===undefined)resolved.narration=change.narrationShort;
    if(typeof resolved.heading==='string')resolved.heading=resolved.heading.split('\n');
    if(!Array.isArray(resolved.heading)||resolved.heading.some(line=>typeof line!=='string'))throw new Error(`Copy for ${shot.id}.heading must be an array of strings or a newline-separated string.`);
    for(const key of ['subtitle','narration','narrationShort'])if(typeof resolved[key]!=='string')throw new Error(`Copy for ${shot.id}.${key} must be a string.`);
    for(const [key,value]of Object.entries(resolved.labels))if(typeof value!=='string')throw new Error(`Label ${key} must be a string.`);
    return resolved;
  });
  const languages={narration:language,onScreenText:language,subtitles:null,...(typeof custom.language==='object'?custom.language:{})};
  const typography=typographyFor(language,custom.typography||{});
  return {title:custom.title??localized.title??base.title,labels,shots,language:languages,typography};
}
function virgaDropTiming(duration) {
  // The final result begins only after the last real droplet has disappeared.
  // Scale local lifetimes to preserve a legible final hold at both 4s and 5s.
  const motionEnd=Math.max(.65,duration-.48),scale=motionEnd/1.84;
  const drops=[{x:198,delay:0,life:1.38,r:39},{x:300,delay:.22,life:1.44,r:31},{x:401,delay:.48,life:1.36,r:25}].map(d=>({...d,delay:d.delay*scale,life:d.life*scale}));
  const lastDropEndpoint=Math.max(...drops.map(d=>d.delay+d.life));
  return {drops,lastDropEndpoint,resultStart:lastDropEndpoint+.025,resultFull:lastDropEndpoint+.14};
}

async function loadAssets(assetsDir, caseName) {
  if(!assetsDir)return {};
  const dir=pathModule.resolve(assetsDir);let manifest={};const manifestPath=pathModule.join(dir,'assets-manifest.json');
  if(fs.existsSync(manifestPath))manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  const roles={
    weatherBackdrop:['weather-backdrop.png','weather-backdrop.jpg','backdrop.png'],
    virgaBackdrop:['virga-backdrop.png','virga-backdrop.jpg'],
    thermalBackdrop:['thermal-backdrop.png','thermal-backdrop.jpg'],
    transferBackdrop:['transfer-backdrop.png','transfer-backdrop.jpg'],
    cloud:['cloud.png','rain-cloud.png','cloud.webp'],
  };
  const result={};
  for(const [role,candidates] of Object.entries(roles)){
    if(role.startsWith('transfer')&&caseName!=='transfer')continue;
    if(caseName==='transfer'&&role!=='transferBackdrop')continue;
    const named=manifest[role];const files=named?[typeof named==='string'?named:named.file]:candidates;
    const candidate=files.map(f=>pathModule.resolve(dir,f)).find(f=>fs.existsSync(f));
    if(candidate) result[role]={image:await loadImage(candidate),file:candidate};
  }
  return result;
}

function createSceneMetadata(caseName,seconds=4,width=540,height=Math.round(width*16/9),options={}) {
  if(!CASES[caseName])throw new Error(`Unknown case ${caseName}. Choose virga, thermal, or transfer.`);
  const copy=resolveProjectCopy(caseName,options.language||'en',options.copy||{});
  return {
    formatVersion:2,case:caseName,title:copy.title,width,height,fps:30,duration:seconds,
    language:copy.language,typography:copy.typography,copy:{title:copy.title,labels:copy.labels,shots:copy.shots.map(s=>({id:s.id,heading:s.heading,subtitle:s.subtitle,narration:s.narration,narrationShort:s.narrationShort,labels:s.labels}))},sound:'silent picture render; attach narration and semantic SFX separately',
    illustration:'Original matte layered illustration; generated raster scenery may be supplied separately. No reference frames are used as production artwork.',
    cameraLockedReview:true,deterministic:true,scientificScope:'Qualitative explanatory illustration; sizes, speeds, colors, and timings are illustrative and are not numerical claims.',
    shots:copy.shots.map((s,index)=>{
      const start=s.fraction[0]*seconds,end=s.fraction[1]*seconds,duration=end-start;
      const timing=caseName==='virga'&&index===1?virgaDropTiming(duration):null;
      return {...s,start:Number(start.toFixed(3)),end:Number(end.toFixed(3)),text:s.heading.join('\n'),motionAnchor:caseName==='transfer'?'source at the left end / immersed bowl':'world coordinates; heading remains fixed in screen space',resultHoldSeconds:timing?Number((duration-timing.resultFull).toFixed(3)):Number(Math.max(.3,duration-(index===0?1.65:1.46)).toFixed(3)),...(timing?{timing:{lastDropEndpoint:Number((start+timing.lastDropEndpoint).toFixed(3)),resultLabelStart:Number((start+timing.resultStart).toFixed(3)),resultLabelFull:Number((start+timing.resultFull).toFixed(3))}}:{})};
    }),
    safeAreas:{heading:[35,78,470,180],activeMechanism:[40,300,460,545],bottomMargin:75},
    assets:[],
  };
}

async function createRenderer(options={}) {
  const caseName=options.case||options.caseName||'virga', width=Math.round(options.width||540),height=Math.round(options.height||width*16/9),seconds=Number(options.seconds||4);
  if(seconds<=0||seconds>5)throw new Error('Probe duration must be greater than zero and no more than 5 seconds.');
  if(width<180||width>2160)throw new Error('Width must be between 180 and 2160 pixels.');
  const defaultAssets=pathModule.resolve(__dirname,'../assets/style-atlas');
  const assetsDir=(options.assetsDir===false||options.assetsDir==='none'||options.assetsDir==='native')?null:(options.assetsDir||(fs.existsSync(defaultAssets)?defaultAssets:null));
  const metadata=createSceneMetadata(caseName,seconds,width,height,{language:options.language,copy:options.copy}),assets=await loadAssets(assetsDir,caseName);
  metadata.assetDirectory=assetsDir;
  metadata.assets=Object.entries(assets).map(([role,v])=>({role,file:v.file}));
  metadata.layerSources={environment:caseName==='transfer'?'bundled interior material plus native wall lamp, framed vessel print, shelf, wooden table':assets[`${caseName}Backdrop`]||assets.weatherBackdrop?'bundled weather backdrop plus native light rays':'native layered landscape',cloud:caseName==='transfer'?null:assets.cloud?'bundled transparent cloud':'native matte cloud',primarySubject:'native vector paths and deterministic state deformation',type:'native exact composite',grain:'fixed seeded texture'};
  const canvas=createCanvas(width,height),ctx=canvas.getContext('2d'),grain=paperTexture();configureTextContext(ctx,metadata.typography);
  const nativeSky=skyBackground(),nativeRoom=roomBackground(assets.transferBackdrop?.image),nativeCloud=makeCloud({storm:caseName==='virga'});
  const cloudImage=assets.cloud?.image||nativeCloud;
  const backdrop=caseName==='transfer'?nativeRoom:(assets[`${caseName}Backdrop`]?.image||assets.weatherBackdrop?.image||nativeSky);
  const planGround=createPlanGround(grain),macroSky=createMacroSky(grain);
  const renderFrame=(time,frameOptions={})=>{
    const t=clamp(Number(time)||0,0,seconds-1/300),shotIndex=t<seconds*.525?0:1,shot=metadata.shots[shotIndex],local=t-shot.start,localDuration=shot.end-shot.start,p=clamp(local/localDuration);
    ctx.setTransform(width/540,0,0,height/960,0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.clearRect(0,0,540,960);
    ctx.save();
    // Camera is deliberately locked in the supplied probes. The option is part
    // of the public interface so larger productions can review the same action.
    if(caseName==='virga'){
      if(shotIndex===0)virgaContext(ctx,{t:local,p,backdrop,cloudImage,grain,labels:shot.labels});
      else virgaSection(ctx,{t:local,p,duration:localDuration,macroSky,grain,labels:shot.labels});
    } else if(caseName==='thermal'){
      if(shotIndex===0)thermalSection(ctx,{t:local,p,backdrop,cloudImage,grain});
      else thermalPlan(ctx,{t:local,p,planGround,grain,labels:shot.labels});
    } else {
      if(shotIndex===0)transferContext(ctx,{t:local,p,backdrop,grain,labels:shot.labels});
      else transferComparison(ctx,{t:local,p,grain,labels:shot.labels});
    }
    ctx.restore();
    heading(ctx,{lines:shot.heading,highlight:shot.highlight,subtitle:shot.subtitle,time:local,size:metadata.typography.headingSize});
    // The image remains populated through the last frame. Cuts are semantic,
    // short, and direct; no blank interstitial or fade-to-black is inserted.
    return canvas;
  };
  return {canvas,width,height,seconds,fps:30,metadata,renderFrame,renderLockedFrame:t=>renderFrame(t,{lockedCamera:true}),assets};
}

function virgaContext(ctx,{t,p,backdrop,cloudImage,grain,labels}) {
  drawCover(ctx,backdrop);
  lightRays(ctx,{opacity:.75});
  // A lower-value patch unifies generated scenery with the exact composite type.
  ctx.fillStyle=linear(ctx,0,0,0,280,[[0,rgba(PALETTE.deep,.16)],[1,rgba(PALETTE.deep,0)]]);ctx.fillRect(0,0,540,280);
  drawCloud(ctx,cloudImage,267,417,403,{sway:2*Math.sin(t*.55)});
  rainCurtain(ctx,t,{top:489,bottom:772,width:312,count:83});
  // Dashed lower edge is deliberately absent: the changing drops supply the idea.
  pill(ctx,labels.groundDry,270,876,{fill:rgba(PALETTE.deep,.85),color:PALETTE.ivory,size:17});
  applyGrain(ctx,grain,.22);
}
function createMacroSky(grain) {
  const c=skyBackground({ridges:false,warmth:.45,seed:41}),ctx=c.getContext('2d');
  ctx.fillStyle=linear(ctx,0,300,0,960,[[0,'rgba(31,64,101,0)'],[.48,'rgba(39,68,94,.04)'],[1,'rgba(38,67,91,.48)']]);ctx.fillRect(0,0,540,960);
  applyGrain(ctx,grain,.6);return c;
}
function virgaSection(ctx,{t,p,duration,macroSky,grain,labels}) {
  ctx.drawImage(macroSky,0,0);
  // The macro is a cut through the air, not a reused landscape with a box on it.
  // Keep the atmosphere open and full-frame; a decorative dark UI card makes
  // these large physical subjects read as tiny chart icons.
  softEllipse(ctx,302,612,246,246,PALETTE.horizon,.20);
  label(ctx,labels.dryAir,56,361,{size:20,color:PALETTE.gold});
  strokePath(ctx,[[87,405],[87,740]],PALETTE.ivory,1.5,.34,[4,10]);arrow(ctx,87,574,Math.PI/2,36,PALETTE.ivory,2,.7);
  // Staggered one-way lifetimes: every droplet has its own shrinking silhouette.
  const timing=virgaDropTiming(duration),drops=timing.drops;
  for(const d of drops){const q=range(t,d.delay,d.delay+d.life),visible=t>=d.delay&&q<1;if(!visible)continue;const rr0=d.r*Math.pow(1-q,.9),y=410+q*298;droplet(ctx,d.x+q*5,y,rr0,{alpha:1-smooth(range(q,.83,1)),color:'#c7dce7',stretch:1.2});}
  // Three faint marks are distance guides, not vapor or a byproduct.
  for(let i=0;i<3;i++)strokePath(ctx,[[121,449+i*103],[143,449+i*103]],PALETTE.haze,1,.18);
  const result=smooth(range(t,timing.resultStart,timing.resultFull));
  label(ctx,labels.evaporated,270,792,{size:24,align:'center',color:PALETTE.ivory,alpha:result*.96});
  applyGrain(ctx,grain,.20);
}

function thermalSection(ctx,{t,p,backdrop,cloudImage,grain}) {
  drawCover(ctx,backdrop);
  lightRays(ctx,{opacity:.75});
  // Smaller peripheral clouds establish scale without covering the active path.
  drawCloud(ctx,cloudImage,29,396,113,{opacity:.75});drawCloud(ctx,cloudImage,506,370,112,{opacity:.78});
  const base=810,top=390;
  softColumn(ctx,270,top,base,{width:238,alpha:.46});
  softEllipse(ctx,270,765,100,72,PALETTE.amber,.14);
  warmPatch(ctx,270,818,178,29);
  const q=smooth(range(t,.13,1.64)),x=268+7*Math.sin(q*2.1),y=lerp(752,426,q);warmParcel(ctx,x,y,lerp(27,38,q),q*.75);
  const path1=[[235,783],[229,657],[239,552],[248,447]];flowMarkers(ctx,path1,t,{count:2,period:1.72,color:PALETTE.amber,size:30,width:4,alpha:.85});
  const path2=[[309,795],[325,660],[312,565],[308,441]];flowMarkers(ctx,path2,t,{count:2,period:2.13,offset:.3,color:PALETTE.gold,size:25,width:3.4,alpha:.62});
  // One sparse reference ring makes ascent legible against a still background.
  ctx.save();ctx.setLineDash([4,7]);ctx.strokeStyle=rgba(PALETTE.ivory,.22);ctx.lineWidth=1.1;ctx.beginPath();ctx.ellipse(270,579,89,14,0,0,TAU);ctx.stroke();ctx.restore();
  applyGrain(ctx,grain,.20);
}
function createPlanGround(grain) {
  const c=createCanvas(540,960),ctx=c.getContext('2d');ctx.fillStyle=linear(ctx,0,0,0,960,[[0,'#25456b'],[.6,'#526b7a'],[1,'#30485a']]);ctx.fillRect(0,0,540,960);
  // A true plan view has contiguous fields and winding surface boundaries.
  ctx.save();ctx.beginPath();ctx.ellipse(270,602,249,236,-.08,0,TAU);ctx.clip();ctx.fillStyle='#778578';ctx.fillRect(10,350,520,520);
  polygon(ctx,[[0,404],[155,352],[239,475],[176,604],[0,589]],'#839181');
  polygon(ctx,[[155,352],[369,345],[351,514],[239,475]],'#708475');
  polygon(ctx,[[369,345],[554,417],[531,625],[354,614],[351,514]],'#687e77');
  polygon(ctx,[[0,589],[176,604],[229,815],[20,854]],'#6b8077');
  polygon(ctx,[[176,604],[354,614],[407,843],[229,815]],'#9b967c');
  polygon(ctx,[[354,614],[531,625],[550,871],[407,843]],'#7d8b7d');
  curve(ctx,[[0,567],[150,521],[189,671],[540,609]],'#b7c2b5',8,.45);curve(ctx,[[0,567],[150,521],[189,671],[540,609]],'#a3b1ab',3,.65);
  curve(ctx,[[183,350],[260,466],[134,669],[250,868]],'#d0bc94',3,.40);
  for(let i=0;i<9;i++)curve(ctx,[[370+i*12,391],[354+i*14,442],[371+i*14,482],[369+i*15,521]],'#a7b19b',1,.17);
  ctx.restore();ellipse(ctx,270,602,249,236,radial(ctx,263,588,270,'#1a334a',.03));
  softEllipse(ctx,270,846,232,50,PALETTE.deep,.18);applyGrain(ctx,grain,.60);vignette(ctx,.18);return c;
}
function thermalPlan(ctx,{t,p,planGround,grain,labels}) {
  ctx.drawImage(planGround,0,0);
  // Local light is tied to the warm surface patch, not to the whole screen.
  softEllipse(ctx,271,594,106,97,PALETTE.amber,.24);ellipse(ctx,271,594,49,43,rgba('#b99b63',.78));
  ctx.save();ctx.strokeStyle=rgba(PALETTE.gold,.28);ctx.lineWidth=1.2;ctx.setLineDash([5,7]);ctx.beginPath();ctx.ellipse(271,594,67+3*Math.sin(t*1.5),59+3*Math.sin(t*1.5),0,0,TAU);ctx.stroke();ctx.restore();
  const paths=[[[74,530],[102,499],[166,513],[235,570]],[[468,487],[423,483],[366,516],[303,566]],[[431,751],[396,701],[361,654],[304,617]],[[89,733],[135,707],[183,649],[234,613]]];
  paths.forEach((route,i)=>{curve(ctx,route,PALETTE.haze,1,.14,[3,8]);flowMarkers(ctx,route,t,{count:2,period:2.1+i*.13,offset:i*.16,color:i%2?PALETTE.haze:'#c7d2cc',size:24,width:2.8,alpha:.70});});
  // Upward-pointing center mark reads as the column seen from above.
  const q=smooth(range(t,.05,1.45));warmParcel(ctx,271,594,lerp(25,35,q),.1,.84);ellipse(ctx,271,594,5,5,PALETTE.ivory,.6);
  label(ctx,labels.risingColumn,270,893,{align:'center',size:18,color:PALETTE.ivory});
  applyGrain(ctx,grain,.18);
}

function transferContext(ctx,{t,p,backdrop,grain,labels}) {
  drawCover(ctx,backdrop);
  const q=smooth(range(t,.1,1.65));
  // Spooned bowls and handles stay attached. Heat state varies independently.
  spoon(ctx,212,655,{angle:-.11,wood:false,hot:q*.98,scale:1.05});spoon(ctx,331,655,{angle:.11,wood:true,hot:q*.26,scale:1.05});
  basin(ctx,270,758);
  // A narrow rim redraw makes the submerged bowls sit behind the vessel.
  curve(ctx,[[133,758],[164,790],[368,791],[410,757]],'#90a5ac',6,.65);
  label(ctx,labels.metal,185,472,{align:'center',size:18,color:PALETTE.ivory});label(ctx,labels.wood,348,472,{align:'center',size:18,color:PALETTE.ivory});
  applyGrain(ctx,grain,.20);
}
function transferComparison(ctx,{t,p,grain,labels}) {
  ctx.fillStyle=linear(ctx,0,0,540,960,[[0,'#24415e'],[.62,'#38566b'],[1,'#718085']]);ctx.fillRect(0,0,540,960);
  softEllipse(ctx,99,654,240,290,PALETTE.horizon,.10);
  // The close-up uses a larger material silhouette, not a duplicate room.
  panel(ctx,43,327,454,473,{radius:18,alpha:.94});
  label(ctx,labels.metal,104,425,{size:21,color:PALETTE.ivory});label(ctx,labels.wood,104,627,{size:21,color:PALETTE.ivory});
  const q=easeOut(range(t,.04,1.46));
  materialBar(ctx,105,453,332,45,{progress:lerp(.12,.93,q)});
  materialBar(ctx,105,655,332,45,{wood:true,progress:lerp(.12,.30,q)});
  // Shared warm source remains attached to both left ends.
  rr(ctx,73,436,25,281,9);ctx.fillStyle=linear(ctx,73,0,99,0,[[0,'#cb8e3e'],[.6,'#edb45b'],[1,'#a56b30']]);ctx.fill();
  softEllipse(ctx,86,575,39,154,PALETTE.amber,.11);
  label(ctx,labels.warmEnd,270,758,{align:'center',size:18,color:PALETTE.gold});
  strokePath(ctx,[[176,752],[86,752],[86,720]],PALETTE.gold,1.2,.67);
  ellipse(ctx,86,720,2.5,2.5,PALETTE.gold,.85);
  const metalMax=103+332*lerp(.1,.90,q),woodMax=103+332*lerp(.1,.27,q);
  for(let i=0;i<3;i++){const xx=136+i*63;if(xx<metalMax-17)arrow(ctx,xx,475,0,21,PALETTE.deep,2.3,.47);}
  if(woodMax>160)arrow(ctx,142,677,0,19,PALETTE.deep,2.2,.46);
  // Show the local moving warmth edge on the material itself. An isolated tick
  // beneath an unlabelled bar would imply an unexplained measurement scale.
  strokePath(ctx,[[metalMax,458],[metalMax,493]],PALETTE.ivory,2,.73);
  strokePath(ctx,[[woodMax,660],[woodMax,695]],PALETTE.gold,2,.88);
  applyGrain(ctx,grain,.36);vignette(ctx,.10);
}

// The full-story evaluator uses these same functions for stills and animation.
// Phase/state depends only on local time, never on which frame was drawn before.
function drawPlannedVirga(ctx,{type,t,p,duration,grain,macroSky,backdrop,cloudImage,params={},language='en'}){
 const fa=language==='fa',copy={
  surface:fa?'سطح زمین':'SURFACE',above:fa?'هنوز بالاتر از زمین':'STILL ABOVE THE GROUND',
  dryAir:fa?'هوای خشک':'DRY AIR',shrinkHere:fa?'قطره‌ها اینجا کوچک می‌شوند':'Drops shrink here',
  liquidEdge:fa?'مرز آب مایع':'LIQUID EDGE',clearAir:fa?'هوای شفاف':'CLEAR AIR',
  noVisibleVapor:fa?'بخار دیده نمی‌شود':'No visible vapor',lessLiquid:fa?'آب مایع کمتر':'LESS LIQUID',
  liquid:fa?'مایع':'LIQUID',vapor:fa?'بخار':'VAPOR',invisible:fa?'نامرئی':'INVISIBLE',
  evaporating:fa?'در حال تبخیر':'EVAPORATING',noDrop:fa?'قطرهٔ مایع باقی نمی‌ماند':'No liquid drop remains',
  aboveSurface:fa?'هنوز بالاتر از سطح زمین':'STILL ABOVE THE SURFACE',
  ...params.labels,
 };
 if(type==='virga-context'||type==='virga-return'){
  virgaContext(ctx,{t,p,backdrop,cloudImage,grain,labels:LABELS[language]||LABELS.en});return;
 }
 ctx.drawImage(macroSky,0,0);
 if(type==='virga-track'){
  softEllipse(ctx,363,652,245,275,PALETTE.horizon,.19);
  strokePath(ctx,[[164,367],[164,771]],PALETTE.ivory,1.5,.45,[4,10]);arrow(ctx,164,624,Math.PI/2,33,PALETTE.ivory,2,.8);
  const q=smooth(range(t,.10,duration-.55));if(q<1)droplet(ctx,290,lerp(405,745,q),46*Math.pow(1-q,.75),{color:'#c7dce7',alpha:1-smooth(range(q,.9,1))});
  strokePath(ctx,[[64,812],[478,812]],PALETTE.deep,3,.9);label(ctx,copy.surface,478,841,{align:'right',size:18});label(ctx,copy.above,270,893,{align:'center',size:17});
 }else if(type==='virga-section'){
  drawCover(ctx,backdrop);drawCloud(ctx,cloudImage,349,354,245);
  ctx.fillStyle=linear(ctx,0,436,0,771,[[0,rgba(PALETTE.gold,.03)],[.5,rgba(PALETTE.gold,.19)],[1,rgba(PALETTE.gold,.03)]]);ctx.fillRect(0,436,540,335);
  rainCurtain(ctx,t,{x:351,top:395,bottom:757,width:166,count:38});strokePath(ctx,[[83,448],[66,448],[66,735],[83,735]],PALETTE.gold,2,.8);
  label(ctx,copy.dryAir,96,540,{size:23,color:PALETTE.gold});label(ctx,copy.shrinkHere,96,577,{size:17});
 }else if(type==='virga-boundary'){
  softEllipse(ctx,102,600,260,280,PALETTE.horizon,.16);
  const q=smooth(range(t,.10,duration-.45)),r=lerp(177,117,q),cx=38,cy=608+q*24;
  droplet(ctx,cx,cy,r,{color:'#c7dce7',stretch:1.2});
  ctx.save();ctx.setLineDash([5,10]);ctx.strokeStyle=rgba(PALETTE.ivory,.42);ctx.lineWidth=1.5;ctx.beginPath();ctx.ellipse(33,621,151,202,0,-1,1.1);ctx.stroke();ctx.restore();
  const edge=cubicPoint([[cx,cy-r*1.2],[cx+r*.35,cy-r*.55],[cx+r*.78,cy-r*.15],[cx+r*.72,cy+r*.38]],.65);
  label(ctx,copy.liquidEdge,324,526,{align:'center',size:20});strokePath(ctx,[[257,543],[215,543],[edge.x,edge.y]],PALETTE.ivory,1.3,.65);
  label(ctx,copy.clearAir,365,704,{align:'center',size:21,color:PALETTE.gold});label(ctx,copy.noVisibleVapor,365,739,{align:'center',size:16});
 }else if(type==='virga-macro'){
  softEllipse(ctx,270,574,215,231,PALETTE.horizon,.16);const q=smooth(range(t,.1,duration-.5));
  if(q<1)droplet(ctx,270,535+q*45,82*(1-q),{color:'#c7dce7',stretch:1.2});
  strokePath(ctx,[[143,731],[397,731]],PALETTE.ivory,1.5,.6);for(let k=0;k<7;k++)strokePath(ctx,[[143+k*42.3,731],[143+k*42.3,744]],PALETTE.ivory,1,.55);
  label(ctx,copy.lessLiquid,270,806,{align:'center',size:23,color:PALETTE.gold});
 }else if(type==='virga-comparison'){
  strokePath(ctx,[[270,380],[270,761]],PALETTE.ivory,1,.24);droplet(ctx,139,535,58,{color:'#c7dce7',stretch:1.2});
  const q=smooth(range(t,.1,duration-.45));if(q<1)droplet(ctx,401,535+q*48,58*(1-q),{color:'#c7dce7',stretch:1.2});
  if(q===1)label(ctx,copy.invisible,401,545,{align:'center',size:19});label(ctx,copy.liquid,139,698,{align:'center',size:23});label(ctx,q===1?copy.vapor:copy.evaporating,401,698,{align:'center',size:q===1?23:17,color:PALETTE.gold});
  if(q===1)label(ctx,copy.noDrop,270,837,{align:'center',size:21});
 }else if(type==='virga-trails'){
  drawCloud(ctx,cloudImage,270,359,600);
  for(const [x,bottom,w,seed]of [[118,778,90,31],[260,714,100,54],[401,745,100,73]]){softEllipse(ctx,x,550,38,167,PALETTE.haze,.08);rainCurtain(ctx,t,{x,top:450,bottom,width:w,count:40,seed});}
  strokePath(ctx,[[50,843],[490,843]],PALETTE.ivory,1,.34,[4,8]);label(ctx,copy.aboveSurface,270,879,{align:'center',size:18});
 }else throw new Error(`Unsupported planned Virga scene ${type}`);
 applyGrain(ctx,grain,.22);
}

module.exports={
  PALETTE,palette:PALETTE,createRenderer,createSceneMetadata,resolveProjectCopy,CASES,LABELS,PERSIAN_COPY,registerFonts,
  easing:{clamp,lerp,smooth,smoother,easeOut,easeInOut,range,mod},
  material:{linear,radial,rgba,mix,softEllipse,ellipse,panel,glowBand,softColumn,paperTexture,applyGrain,lightRays,vignette,makeCloud,drawCloud,droplet,warmParcel,warmPatch,spoon,basin,materialBar,skyBackground,roomBackground,drawCover},
  text:{heading,label,pill,lineText,configureContext:configureTextContext,typographyFor},path:{rr,polygon,strokePath,curve,cubicPoint,cubicTangent,arrow},
  flow:{flowMarkers,rainCurtain,seeded},
  scenes:{createMacroSky,createPlanGround,virgaContext,virgaSection,thermalSection,thermalPlan,transferContext,transferComparison,drawPlannedVirga},
};
