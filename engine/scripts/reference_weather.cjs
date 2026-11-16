'use strict';

const {createCanvas, Path2D} = require('@napi-rs/canvas');
const clamp = t => Math.max(0,Math.min(1,t));
const mix = (a,b,t) => a+(b-a)*t;
const smooth = t => {const q=clamp(t);return q*q*(3-2*q);};
const wrap = t => (t%1+1)%1;
const TAU = Math.PI*2;
const terrainCache = new Map(), cloudCache = new Map(), outlines = new Map();

function path(d) {
  if (!outlines.has(d)) outlines.set(d,new Path2D(d));
  return outlines.get(d);
}
function plate(c,d,fill) { c.fillStyle=fill; c.fill(path(d)); }
function line(c,d,stroke,width) {
  c.strokeStyle=stroke; c.lineWidth=width; c.lineCap='round'; c.stroke(path(d));
}

const ridge='M-31 777 C29 761 61 736 102 716 C131 702 157 712 188 689 C215 669 220 650 247 632 C273 613 284 596 311 570 C332 549 346 533 370 545 C392 555 408 581 434 596 C459 610 486 601 512 622 C537 641 555 658 575 674 L575 991 L-31 991 Z';
const slope='M-25 855 C31 812 55 765 96 741 C141 715 179 719 216 677 C251 636 284 610 323 592 C365 572 401 542 439 528 C481 511 517 504 568 459 L568 990 L-25 990 Z';

function trees(c,kit,entries,color,shadow) {
  for (const [x,y,h] of entries) {
    kit.material.ellipse(c,x+4,y,h*.52,h*.11,shadow,.26);
    kit.path.polygon(c,[[x,y-h],[x-.27*h,y-.22*h],[x-.12*h,y-.24*h],
      [x-.28*h,y],[x+.29*h,y],[x+.12*h,y-.24*h],[x+.24*h,y-.21*h]],color);
  }
}
function broadRidge(c,kit,wet,dry) {
  const m=kit.material;
  plate(c,'M-29 697 C35 680 65 637 91 621 C121 604 145 604 161 578 C178 554 193 541 208 550 C231 561 245 602 278 628 C314 656 332 652 363 640 C400 624 430 633 460 614 C494 593 518 620 567 651 L567 874 L-29 874Z',
    m.linear(c,0,543,0,795,[[0,'#a1aec5'],[.55,'#8fa3bd'],[1,'#798eaa']]));
  plate(c,'M-22 719 C33 710 68 695 98 669 C119 651 137 646 155 626 C176 604 190 586 210 592 C240 603 246 641 267 654 C293 671 317 652 348 661 C377 667 396 684 420 671 C459 650 485 636 516 646 Q541 655 565 665 L566 860 L-22 860Z',
    m.linear(c,0,587,0,790,[[0,'#839ab7'],[1,'#677f9b']]));
  plate(c,ridge,m.linear(c,75,537,464,846,[[0,'#7f97b3'],[.35,'#7289a6'],[.69,'#627e9b'],[1,'#738899']]));
  c.save(); c.clip(path(ridge));
  m.softEllipse(c,136,722,245,192,'#43658b',.48*wet);
  m.softEllipse(c,439,624,211,195,'#d9b698',.77*dry);
  m.softEllipse(c,165,705,186,85,'#98b2c5',.34*wet);
  m.softEllipse(c,401,661,166,136,'#e1c4a6',.22*dry);
  m.softEllipse(c,190,710,281,97,'#bac7cd',.35);
  m.softEllipse(c,347,560,87,44,'#f2d4b4',.27);
  m.applyGrain(c,m.paperTexture(540,960,221),.79);
  c.restore();
  line(c,'M247 632 C273 613 284 596 311 570 C332 549 346 533 370 545 C392 555 408 581 434 596',m.rgba('#dfd2c2',.56),2.1);
  c.save(); c.filter='blur(2px)';
  plate(c,'M-31 814 C57 786 92 766 131 763 C165 759 206 771 240 747 C282 718 303 687 333 700 C368 715 394 755 434 762 C482 772 515 768 572 801 L571 988 L-31 988Z',
    m.linear(c,0,690,100,883,[[0,'#68849d'],[.55,'#617d91'],[1,'#516a7f']]));
  c.restore();
  plate(c,'M-18 785 C58 753 119 777 171 744 C220 717 249 722 285 748 C298 757 319 767 346 765 C336 822 345 885 366 980 L-18 980Z',
    m.linear(c,5,728,69,900,[[0,'#879e8d'],[.64,'#6b887b'],[1,'#506c69']]));
  plate(c,'M269 833 C314 791 344 766 395 750 C434 738 476 768 493 761 C519 753 533 742 563 750 L565 985 L268 985Z',
    m.linear(c,361,751,422,932,[[0,m.mix('#8e9688','#b1a37e',dry)],[1,'#68786f']]));
  plate(c,'M-25 831 C44 808 92 816 149 802 C186 792 224 783 260 799 C286 812 323 822 353 815 L344 917 L-25 921Z',
    m.linear(c,5,789,190,906,[[0,'#709085'],[1,'#577569']]));
  line(c,'M-15 825 C51 817 81 824 119 809 C149 797 176 788 198 795 C223 803 241 806 271 811',m.rgba('#bbd0c8',.65),2.7);
  line(c,'M-15 831 C69 825 116 804 180 800 C217 797 263 807 309 817 C371 830 460 804 556 810',m.rgba('#bfbbb0',.63),3.2);
  trees(c,kit,[[34,795,14],[53,789,9],[104,783,19],[120,783,11],[148,772,16],[169,773,12],[201,760,10],[220,756,13]],'#4b6b65','#203d45');
  trees(c,kit,[[385,781,10],[429,801,8],[459,793,10],[505,791,13]],'#6f7e69','#324951');
}
function crossSection(c,kit,lee) {
  const m=kit.material;
  c.save();
  if (lee) { c.translate(540,0); c.scale(-1,1); }
  const top=lee?'#b7a885':'#a3aa8a', bottom=lee?'#77796c':'#536f67';
  plate(c,slope,m.linear(c,220,534,280,960,[[0,top],[.57,m.mix(top,bottom,.53)],[1,bottom]]));
  c.save(); c.clip(path(slope));
  plate(c,'M-24 914 C70 853 121 819 181 796 C250 769 254 706 313 682 C372 659 437 650 477 599 C510 565 530 567 565 544 L565 980 L-24 980 Z',m.rgba(lee?'#7d7d71':'#708b77',.72));
  plate(c,'M-30 961 C65 947 105 908 157 895 C218 881 243 842 312 823 C366 809 427 780 474 744 C511 718 533 715 563 704 L563 980 L-30 980 Z',m.rgba(lee?'#686e68':'#4f6c66',.53));
  c.restore();
  line(c,'M-5 845 C31 811 55 765 96 741 C141 715 179 719 216 677 C251 636 284 610 323 592 C365 572 401 542 439 528 C481 511 516 505 552 473',m.rgba(lee?'#ead0a7':'#d8d9b1',.79),2.6);
  trees(c,kit,[[37,818,16],[65,792,19],[108,770,13],[153,755,16],[245,674,15],[290,635,17],[332,622,12],[391,582,13],[476,548,11]],lee?'#697663':'#536f63','#43584e');
  c.restore();
}
function foreground(c,kit) {
  const m=kit.material;
  plate(c,'M-20 857 C68 849 109 864 160 853 C225 839 268 844 322 859 C382 871 450 837 562 846 L562 980 L-20 980 Z',
    m.linear(c,0,843,0,960,[[0,'#304c58'],[1,'#203248']]));
  const rand=kit.flow.seeded(941);
  for (let i=0;i<40;i++) {
    const x=rand()*540,y=873+rand()*24,h=5+rand()*17;
    kit.path.strokePath(c,[[x-2,y],[x,y-h]],'#799087',1.1,.12+rand()*.23);
  }
}
function overhead(c,kit) {
  const m=kit.material;
  c.fillStyle=m.linear(c,0,0,540,960,[[0,'#465d5f'],[.46,'#81917a'],[1,'#6c7b69']]);
  c.fillRect(0,0,540,960);
  const swatches=['#88977c','#9ca286','#a8a183','#a7aa84','#728a76','#9e9174','#788c77'];
  const rand=kit.flow.seeded(343);
  for(let row=0;row<10;row++) for(let col=0;col<7;col++) {
    const x=col*91-49+(row%2)*32,y=row*100-6,w=70+rand()*16,h=79+rand()*14;
    const hue=swatches[Math.floor(rand()*swatches.length)];
    kit.path.polygon(c,[[x,y],[x+w,y+3],[x+w-3,y+h],[x-4,y+h-3]],hue,'#606e62',1.2);
    if(rand()>.56)m.ellipse(c,x+w*.74,y+h*.72,6+rand()*4,6+rand()*3,'#526e62',.71);
  }
  plate(c,'M239-25 C187 84 278 161 231 260 C195 348 220 400 235 465 C263 557 224 590 229 657 C236 742 305 830 251 984 L379 986 C410 888 319 780 337 691 C351 614 377 554 347 449 C322 366 333 307 355 238 C382 155 313 72 357-24 Z',
    m.linear(c,193,352,362,352,[[0,'#789184'],[.39,'#9aab94'],[.59,'#8b987f'],[1,'#707e70']]));
  plate(c,'M283-20 C229 99 310 164 266 267 C230 353 257 422 269 467 C300 564 252 610 272 699 C290 782 328 866 287 980 L337 985 C360 865 303 772 313 691 C327 611 348 568 323 463 C296 382 300 317 325 238 C351 143 270 77 323-20 Z',m.rgba('#566f68',.36));
  line(c,'M-20 783 C89 760 167 778 239 802 C342 836 436 791 558 806','#bcc0a4',5);
  line(c,'M295-10 C242 95 322 162 279 264 C242 351 270 423 281 466 C312 562 266 611 286 697 C304 782 341 864 302 981',m.rgba('#d9d6ac',.76),2.4);
  c.fillStyle=m.linear(c,0,0,0,421,[[0,'#243d5a'],[.61,'rgba(36,61,90,.44)'],[1,'rgba(36,61,90,0)']]);
  c.fillRect(0,0,540,424);
}
function relief(api,s) {
  const {ctx,kit}=api, plane=s.plane??'side', key=JSON.stringify([plane,s.wet,s.dry]);
  if(!terrainCache.has(key)) {
    if(terrainCache.size>=16)terrainCache.delete(terrainCache.keys().next().value);
    const layer=createCanvas(1080,1920),c=layer.getContext('2d');
    c.scale(2,2);
    if(plane==='side')broadRidge(c,kit,s.wet??.75,s.dry??.73);
    if(plane==='upslope'||plane==='downslope')crossSection(c,kit,plane==='downslope');
    if(plane==='near')foreground(c,kit);
    if(plane==='overhead')overhead(c,kit);
    terrainCache.set(key,layer);
  }
  ctx.drawImage(terrainCache.get(key),0,0,540,960);
}

// A common base pivot holds the clouds and their attached precipitation.
const CLOUDS={
  fair:'M-98-12 C-104-22-96-36-82-40 C-78-53-64-59-52-56 C-46-70-32-76-18-72 C-14-85 5-94 22-88 C42-88 49-74 52-64 C69-62 77-50 79-42 C95-41 106-27 102-16 C98-3 86-2 72-2 Q52-4 27-1 L-73-1 Q-92-1-98-12Z',
  rain:'M-102-12 C-106-24-98-41-82-45 C-84-62-71-77-56-77 C-49-91-31-103-13-99 C4-102 21-88 23-74 C36-84 57-80 66-67 C75-63 78-53 80-46 C96-47 108-33 104-22 Q103-8 91-5 Q78-1 67-3 Q51 0 33-2 Q10-5-8-2 Q-23 1-46-2 Q-67-5-82-3 Q-96-3-102-12Z',
  tower:'M-99-13 C-104-24-94-39-77-40 C-70-52-57-54-46-50 C-50-63-37-79-22-80 C-19-94-5-105 12-103 C29-111 54-96 55-80 C65-74 68-64 65-55 C81-54 92-46 93-34 C104-27 106-16 97-8 Q87-1 72-3 Q56-1 39-2 Q19-4 6-2 L-76-1 Q-94-2-99-13Z',
  thinning:'M-99-10 Q-105-20-79-25 Q-69-43-44-36 Q-31-54-6-45 Q13-57 38-43 Q60-46 71-31 Q100-31 102-16 Q101-3 76-1 L-79-1 Q-98-1-99-10Z',
  overhead:'M-99-51 C-101-68-87-81-68-83 C-65-98-43-106-22-99 C-2-114 27-111 40-95 C60-103 79-92 83-78 C102-75 108-54 99-42 C96-25 77-19 60-23 C43-3 15 1-4-10 C-27-1-53-7-62-22 C-84-21-99-33-99-51Z',
};
function cloudPlate(kit,variant,stormShade=false) {
  const key = stormShade ? `${variant}:storm` : variant;
  if(cloudCache.has(key))return cloudCache.get(key);
  const canvas=createCanvas(672,360),c=canvas.getContext('2d'),m=kit.material;
  c.translate(336,348);c.scale(3,3);c.clip(path(CLOUDS[variant]));
  const rain=variant==='rain';
  c.fillStyle=m.linear(c,0,-101,0,0,rain
    ?[[0,'#f1efef'],[.38,'#dcdce8'],[.70,'#bec4d8'],[.90,'#a2acc5'],[1,'#8e9ab7']]
    :[[0,'#fffbf5'],[.51,'#f8efec'],[.78,'#e8ddeb'],[1,'#bcb6d0']]);
  c.fillRect(-108,-112,216,112);
  const lobes=rain?[[ -73,-45,35,22],[-44,-65,37,23],[-20,-85,39,24],[36,-67,35,23],[71,-47,31,20],[4,-31,70,22]]
    :[[-67,-42,33,18],[-40,-58,30,19],[17,-79,40,24],[56,-54,34,19],[81,-32,28,17],[1,-34,58,17]];
  for(const [x,y,w,h] of lobes) {
    m.softEllipse(c,x+5,y+h*.69,w*1.15,h*1.15,rain?'#8092b4':'#b5a5c3',rain?.42:.34);
    m.softEllipse(c,x-7,y-h*.39,w*1.03,h*1.24,'#fff9f1',rain?.40:.52);
  }
  c.save();c.filter='blur(1.9px)';
  const shelf='M-106-19 C-96-30-87-34-74-33 Q-60-49-43-42 Q-33-51-12-43 Q2-47 17-37 Q31-45 48-37 Q65-44 77-34 C92-37 105-23 106-14 L106 1 L-106 1Z';
  plate(c,shelf,m.linear(c,0,-47,0,1,rain
    ?[[0,m.rgba('#e7e8ee',.54)],[.57,m.rgba('#bdc5dc',.46)],[1,m.rgba('#8998b8',.70)]]
    :[[0,m.rgba('#fff9f2',.76)],[.59,m.rgba('#f2e5ef',.58)],[1,m.rgba('#c7b7d1',.78)]]));
  plate(c,'M-77-37 Q-73-50-62-50 Q-50-68-36-61 Q-22-72-10-61 Q8-72 24-61 Q43-68 54-51 Q62-50 73-41 Q54-46 40-40 Q25-48 14-43 Q-1-49-21-44 Q-43-47-57-41 Z',
    m.linear(c,0,-69,0,-35,rain?[[0,m.rgba('#ececf2',.52)],[1,m.rgba('#9eabc8',.51)]]
      :[[0,m.rgba('#fff9f4',.72)],[1,m.rgba('#d7c7df',.61)]]));
  c.restore();
  m.softEllipse(c,14,-3,92,15,rain?'#7486aa':'#b6a7c6',rain?.35:.29);
  for(const [x,y,w,h] of [[-77,-27,17,7],[-47,-36,21,8],[-14,-37,22,8],[20,-29,21,8],[51,-27,23,8],[79,-23,13,6]]) {
    m.softEllipse(c,x+2,y+h*.65,w,h,rain?'#879ab8':'#bfaacb',rain?.27:.32);
    m.softEllipse(c,x-3,y-h*.45,w,h*1.1,'#fff8ef',rain?.43:.52);
  }
  if (stormShade) {
    for (const [x,y,rx,ry] of [[-65,-44,23,15],[-40,-60,27,18],[5,-57,29,19],[40,-43,28,16],[68,-25,22,13]]) {
      m.softEllipse(c, x, y, rx, ry, '#7783a5', .43);
      m.softEllipse(c, x-9, y-13, rx*.91, ry, '#efebf1', .31);
    }
    m.softEllipse(c, -4, -3, 106, 17, '#717d9d', .37);
  }
  cloudCache.set(key,canvas);
  return canvas;
}
function cloudArt(api,s,clock) {
  const {ctx:c,kit}=api,w=s.w??180,loft=s.loft??1,q=clamp(s.rainfall??0),h=s.rain_depth??206;
  const flash = clamp(s.flash ?? 0);
  const flashX = s.flash_x ?? 0;
  if(q>0) {
    kit.material.softEllipse(c,5,h*.37,w*.54,h*.60,'#9fb3cf',.24*q);
    const rand=kit.flow.seeded(s.seed??96);
    for(let i=0;i<115;i++) {
      const x=(rand()-.5)*w*.84,speed=.63+rand()*.52,phase=rand(),length=6+rand()*12;
      const p=wrap(clock.time*speed+phase),xx=x+p*w*.10,yy=p*h;
      const a=q*smooth(p*16)*smooth((1-p)*5)*(.41+rand()*.39);
      const rainColor = i%3 ? '#e1e7f3' : '#a0b7d2';
      let spill = 0;
      if (flash > 0) {
        const dx = (xx - flashX*w/200) / (w*.30);
        const dy = (yy - h*.37) / (h*.55);
        spill = flash * Math.exp(-dx*dx - dy*dy);
      }
      const color = spill > 0 ? kit.material.mix(rainColor, '#fff1df', spill*.82) : rainColor;
      kit.path.strokePath(c,[[xx-2,yy-length],[xx,yy]],color,(.9+i%3*.17)*(s.rain_line_scale??1),clamp(a*(1+1.6*spill)*(s.rain_opacity_scale??1)));
    }
  }
  const growth=clamp(s.formation??1),size=w/200,variant=s.variant??'fair';
  if(variant==='overhead')kit.material.softEllipse(c,w*.13,-w*.10,w*.57,w*.23,'#283d44',.43);
  const layer=cloudPlate(kit,variant,s.storm_shade === true);
  c.save();c.scale(size*mix(.82,1,growth),size*loft*mix(.77,1,growth));
  if(growth<.94) {
    const reveal=new Path2D();
    const sections=[[-74,-19,48,26],[-48,-35,44,39],[-16,-52,56,49],[24,-54,58,52],[69,-27,49,37],[4,-17,97,28]];
    for(const [i,[x,y,rx,ry]] of sections.entries()) {
      const phase=smooth((growth-.07*i)/(.60+.018*i));
      if(phase<=0)continue;
      reveal.moveTo(x+rx*phase,y);
      reveal.ellipse(x,y,rx*phase,ry*phase,0,0,TAU);
    }
    c.clip(reveal);
  }
  c.drawImage(layer,-112,-116,224,120);
  if (flash > 0) {
    c.clip(path(CLOUDS[variant]));
    kit.material.softEllipse(c, flashX, -13, 77, 39, '#edf2ff', .88*flash);
    kit.material.softEllipse(c, flashX-16, -5, 41, 17, '#fff0dc', .61*flash);
  }
  c.restore();
}

function directionArrow(c,kit,x,y,angle,length,thickness,fill,alpha) {
  const tail=-length/2,tip=length/2,head=tip-length*.37,half=thickness/2;
  c.save();c.translate(x,y);c.rotate(angle);c.globalAlpha*=alpha;
  const m=kit.material,tint=m.mix(fill,'#fff4d6',.58);
  c.fillStyle=m.linear(c,tail-11,0,tail+9,0,[[0,m.rgba(tint,0)],[1,m.rgba(tint,.59)]]);
  c.fillRect(tail-11,-half,20,thickness);
  kit.path.polygon(c,[[tail,-half],[head,-half],[head,-half*2.45],[tip,0],
    [head,half*2.45],[head,half],[tail,half]],fill);
  c.strokeStyle=fill;c.lineWidth=1.4;c.lineJoin='round';c.stroke();c.restore();
}
function airPath(api,s,clock) {
  const {ctx:c,kit}=api,p=s.points,reach=clamp(s.progress??1),width=s.width??110;
  const tone=s.tone??(s.warm?'warm':'lift');
  const color={lift:'#d6904c',warm:'#d87d71',cool:'#a4c2de',map:'#fff1d1'}[tone];
  const air={lift:'#f3bf76',warm:'#eeb191',cool:'#8caacb',map:'#f8d795'}[tone];
  const sample=t=>{
    const pos=kit.path.cubicPoint(p,t),d=kit.path.cubicTangent(p,t);
    return [pos.x,pos.y,Math.atan2(d.y,d.x)];
  };
  const center=Array.from({length:33},(_,i)=>sample(i/32)),m=kit.material;
  for(const [fraction,alpha] of [[1,.16],[.70,.17],[.38,.14]]) {
    const edge=side=>center.map(([x,y,a],i)=>{
      const off=width*fraction*side*(.24+.26*Math.sin(Math.PI*i/32));
      return [x-Math.sin(a)*off,y+Math.cos(a)*off];
    });
    const [x1,y1]=p[0],[x2,y2]=p[3];
    const g=m.linear(c,x1,y1,x2,y2,[[0,m.rgba(air,0)],[.22,m.rgba(air,alpha)],[.68,m.rgba(air,alpha)],[1,m.rgba(air,0)]]);
    kit.path.polygon(c,[...edge(1),...edge(-1).reverse()],g);
  }
  for(let i=0;i<5;i++) {
    const t=wrap(clock.local*(.25+i*.019)+i*.202+.03),[x,y,a]=sample(t);
    const weight=smooth(t*7)*smooth((1-t)*8),swell=.87+.21*Math.sin(clock.local*2.4+i*1.62);
    c.save();c.translate(x,y);c.rotate(a);
    m.softEllipse(c,0,0,width*.92,width*.60*swell,air,(tone==='cool'?.26:.38)*weight);
    m.softEllipse(c,-width*.17,0,width*.43,width*.20,tone==='cool'?'#d3e4ee':'#fff1cf',.25*weight);
    c.restore();
  }
  const rand=kit.flow.seeded(49);
  for(let i=0;i<24;i++) {
    const t=wrap(clock.local*.38+rand()),side=(rand()-.5)*width*.58,r=1.1+rand()*1.5;
    const [x,y,a]=sample(t),opacity=smooth(t*8)*smooth((1-t)*9);
    m.ellipse(c,x-Math.sin(a)*side,y+Math.cos(a)*side,r,r,tone==='cool'?'#d3e4ee':'#ffedc9',opacity*.40);
  }
  for(let i=0;i<12;i++) {
    const t=wrap(clock.local*(.26+rand()*.16)+rand()),side=(rand()-.5)*width*.79,length=17+rand()*33;
    const [x,y,a]=sample(t),px=x-Math.sin(a)*side,py=y+Math.cos(a)*side;
    const a0=smooth(t*7)*smooth((1-t)*7)*(.26+rand()*.26);
    kit.path.strokePath(c,[[px-Math.cos(a)*length,py-Math.sin(a)*length],[px,py]],tone==='cool'?'#d3e4ee':'#fbf1da',1.3+(i%3)*.52,a0);
  }
  const n=s.count??5;
  for(let i=0;i<n;i++) {
    const t=wrap(clock.local*(.27+i*.009)+i/n+.09+.026*Math.sin(i*2.17)),[x,y,a]=sample(t);
    const opacity=.93*smooth(t*12)*smooth((1-t)*12),offset=((i%3)-1)*width*.13;
    directionArrow(c,kit,x-Math.sin(a)*offset,y+Math.cos(a)*offset,a,s.arrow_length??42,s.thickness??7,color,opacity);
  }
  if(s.parcel) {
    const [x,y]=sample(reach);
    c.save();c.translate(x,y);parcel(api,{r:s.parcel,progress:s.cool??0});c.restore();
  }
}
function parcel(api,s) {
  const {ctx:c,kit}=api,m=kit.material,q=clamp(s.progress??s.cool??0),r=s.r??34;
  const light=m.mix('#f5ce87','#d4ecf1',q),shade=m.mix('#d69154','#85abc5',q);
  const stroke=m.mix('#ffdd9c','#cde6ed',q);
  m.softEllipse(c,0,0,r*1.44,r*1.27,light,.43);
  c.beginPath();c.ellipse(0,0,r,r*.82,0,0,TAU);
  c.fillStyle=m.linear(c,-r,-r,r,r,[[0,m.rgba(light,.87)],[.44,m.rgba(light,.66)],[1,m.rgba(shade,.62)]]);
  c.fill();c.strokeStyle=m.rgba(stroke,.83);c.lineWidth=1.8;c.stroke();
  m.ellipse(c,-r*.35,-r*.34,r*.18,r*.10,'#fff8de',.72);
}
function droplets(api,s,clock) {
  const {ctx:c,kit}=api,m=kit.material,q=clamp(s.progress),rand=kit.flow.seeded(s.seed??62);
  for(let i=0;i<(s.count??29);i++) {
    const a=rand()*TAU,spread=Math.sqrt(rand()),seed=rand(),r=2.1+rand()*4.8;
    const motion=clock.local*(.6+rand()*.6),offset=(1-.54*q)*spread;
    const x=Math.cos(a+motion*.26)*offset*(s.w??360)*.5,y=Math.sin(a+motion*.26)*offset*(s.h??210)*.5;
    const birth=smooth((q-seed*.61)*7),fade=smooth((1-q)*7+.28);
    c.save();c.globalAlpha*=birth*fade;
    m.ellipse(c,x,y,r,r,m.linear(c,x-r,y-r,x+r,y+r,[[0,'#f9fcf9'],[1,'#99c5e1']]));
    m.ellipse(c,x-r*.31,y-r*.35,r*.19,r*.14,'#fffef6',.8);c.restore();
  }
}
// A shallow projected fog field. The foot stays fixed while the soft edge
// rises. Paint banks between depth planes so they can occlude actual objects.
const FOG_COLS = 224, FOG_ROWS = 112;
let fogSurface;
function fogBank(api, s, clock) {
  const density = clamp(s.density ?? .75);
  if (density === 0) return;
  if (!fogSurface) {
    const canvas = createCanvas(FOG_COLS, FOG_ROWS);
    const ctx = canvas.getContext('2d');
    fogSurface = {canvas, ctx, pixels: ctx.createImageData(FOG_COLS, FOG_ROWS)};
  }
  const {canvas, ctx, pixels} = fogSurface;
  const decode = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i+2), 16));
  const base = decode(s.tint ?? '#94abc2');
  const lit = decode(s.lit_tint ?? '#dce1dc');
  const phase = clock.time*(s.drift ?? .30) + (s.seed ?? 0)*1.17;
  const {data} = pixels;
  for (let x=0; x<FOG_COLS; x++) {
    const u = x/(FOG_COLS-1);
    const taper = smooth(Math.min(u, 1-u)*5.5);
    const rim = .115 + .07*Math.sin(u*10 + phase) +
      .035*Math.sin(u*23 - phase*.67) + .25*(1-taper);
    const stream = .88 + .12*Math.sin(u*14 - phase*.82);
    for (let y=0; y<FOG_ROWS; y++) {
      const v = y/(FOG_ROWS-1);
      const front = smooth((v-rim)*4.8);
      const foot = smooth((1-v)*5.2);
      const band = .93 + .07*Math.sin(v*20 + u*7 - phase*.53);
      const tone = clamp(.68 - v*.57 + (1-u)*.27);
      const i = 4*(y*FOG_COLS+x);
      for (let c=0; c<3; c++) data[i+c] = base[c] + (lit[c]-base[c])*tone;
      data[i+3] = 255*density*taper*stream*front*foot*band;
    }
  }
  ctx.putImageData(pixels, 0, 0);
  const height = s.h*(.075 + .925*clamp(s.rise ?? 1));
  api.ctx.drawImage(canvas, -s.w/2, -height, s.w, height);
}

function follow(api,s) {
  const {ctx:c,kit}=api,width=s.w??179,height=s.h??49;
  kit.path.rr(c,-width/2,-height/2,width,height,height/2);
  c.fillStyle=kit.material.mix(s.before_fill??'#25394e',s.after_fill??'#146c70',clamp(s.state??0));
  c.fill();
  kit.text.lineText(c,'\u2066'+s.before+'\u2069',8,{x:0,size:23,color:s.text_fill??'#f7f5ee',align:'center',weight:'bold'});
}

const parts={'relief':relief,'weather-cloud':cloudArt,'air-path':airPath,'air-mass':parcel,'droplets':droplets,'fog-bank':fogBank};
module.exports={parts,follow};
