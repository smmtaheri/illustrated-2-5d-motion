'use strict';

// A shot program describes independently editable objects in a 540 x 960 world.
// No subject, footage, storyboard or shot sequence is selected by this module.
const { createCanvas, Path2D } = require('@napi-rs/canvas');
const stages = new Map();
const clouds = new Map();
const outlines = new Map();
const compositeLayers = [];
const TAU = Math.PI * 2;
const clamp = (x, low = 0, high = 1) => Math.min(high, Math.max(low, x));
const lerp = (a, b, p) => a + (b - a) * p;
const smooth = p => p * p * (3 - 2 * p);
const wrap = (x, cycle) => ((x % cycle) + cycle) % cycle;
const COLORS = {
  amber: '#eca750', gold: '#f4c27b', coral: '#da7a6b', ivory: '#f7f5ec',
  ink: '#142439', steel: '#526982', slate: '#325074', lightBlue: '#9fc6dd',
  blue: '#5789b3', green: '#50735c', shadow: '#172c3f',
};
const color = value => COLORS[value] || value;
const MATTE = {
  slate: ['#7189a1', '#425c79', '#21374f'],
  sage: ['#a2ad91', '#718970', '#445c56'],
  earth: ['#c4a982', '#9a7856', '#635046'],
  amber: ['#ffda9c', '#dda462', '#9b653b'],
  mist: ['#eef1ec', '#b9c9d7', '#6d87a4'],
  ink: ['#263b56','#1c2d46','#14243b'],
};
const paperPatterns = new WeakMap();
let facePaper;

function interpolate(a, b, p) {
  if (typeof a === 'number') return lerp(a, b, p);
  if (Array.isArray(a)) return a.map((v, i) => interpolate(v, b[i], p));
  return p < 1 ? a : b;
}

function value(track, clock) {
  if (!track || typeof track !== 'object' || Array.isArray(track)) return track;
  let t = track.event ? clock.time - clock.eventTime(track.event) : clock.local;
  if (track.repeat) t = wrap(t + (track.phase || 0), track.repeat);
  if (track.wave) {
    const [center, amplitude, period, phase = 0] = track.wave;
    return center + amplitude * Math.sin(TAU * (t / period + phase));
  }
  if (!track.keys) return track;
  const keys = track.keys, index = keys.findIndex(row => row[0] > t + 1e-9);
  if (index === 0) return keys[0][1];
  if (index < 0) return keys.at(-1)[1];
  const [a, before] = keys[index - 1], [b, after] = keys[index];
  const p = (t - a) / (b - a);
  return interpolate(before, after, track.ease === 'step' ? 0 : track.ease === 'smooth' ? smooth(p) : p);
}

function paint(ctx, kit, fill) {
  if (typeof fill === 'string') return color(fill);
  return kit.material.linear(ctx, ...(fill.from || [0, 0]), ...(fill.to || [0, 100]),
    fill.stops.map(([p, c]) => [p, color(c)]));
}

function prefixOfPath(points, progress) {
  const length = points.slice(1).map(([x,y], i) => Math.hypot(x-points[i][0],y-points[i][1]));
  let remaining = clamp(progress)*length.reduce((sum,n)=>sum+n,0);
  const result = [points[0]];
  for (const [i,step] of length.entries()) {
    if (remaining <= 0) break;
    const end = points[i+1];
    result.push(step <= remaining ? end : interpolate(points[i],end,remaining/step));
    remaining -= step;
  }
  return result;
}

function pathShape(spec) {
  if (spec.d) {
    if (!outlines.has(spec.d)) outlines.set(spec.d, new Path2D(spec.d));
    return outlines.get(spec.d);
  }
  const p = new Path2D();
  if (spec.points) {
    const points = spec.reveal == null ? spec.points : prefixOfPath(spec.points,spec.reveal);
    p.moveTo(...points[0]);
    for (const point of points.slice(1)) p.lineTo(...point);
    if (spec.closed !== false && spec.reveal == null) p.closePath();
  } else if (spec.rx != null) {
    p.ellipse(0, 0, spec.rx, spec.ry ?? spec.rx, 0, 0, TAU);
  } else {
    p.roundRect(spec.left || 0, spec.top || 0, spec.w, spec.h, spec.radius || 0);
  }
  return p;
}

function matteBounds(spec, material) {
  if (material.bounds) return material.bounds;
  if (spec.rx != null) {
    const ry = spec.ry ?? spec.rx;
    return [-spec.rx, -ry, 2 * spec.rx, 2 * ry];
  }
  if (spec.points) {
    const xs = spec.points.map(([x]) => x), ys = spec.points.map(([, y]) => y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return [x, y, Math.max(...xs)-x, Math.max(...ys)-y];
  }
  return [spec.left || 0, spec.top || 0, spec.w, spec.h];
}

function matteFace(ctx, kit, path, spec) {
  const m = typeof spec.material === 'string' ? {tone:spec.material} : spec.material;
  const toneColors = MATTE[m.tone || 'slate'];
  if (!toneColors) throw new Error('Unknown matte material ' + m.tone);
  // A supplied solid fill owns the face color; the material adds shallow light
  // and depth around it. Tone palettes remain the fallback for uncolored props.
  const base = typeof spec.fill === 'string' ? color(spec.fill) : null;
  if (base !== null && !/^#[0-9a-f]{6}$/i.test(base)) {
    throw new Error('Matte fill needs a palette name or six-digit hex color.');
  }
  const colors = base === null ? toneColors : [
    kit.material.mix(base, '#ffffff', .12), base,
    kit.material.mix(base, '#000000', .20),
  ];
  const [high, middle, side] = m.tint
    ? colors.map(c => kit.material.mix(c, color(m.tint), .38))
    : colors;
  const [x, y, w, h] = matteBounds(spec, m);
  const depth = m.depth ?? 6;
  const lightFromRight = m.light === 'right';
  const lightX = lightFromRight ? x+w : x, shadeX = lightFromRight ? x : x+w;
  if (depth > 0) {
    ctx.save();
    ctx.translate((lightFromRight ? -.44 : .44)*depth, depth);
    ctx.fillStyle = side;
    ctx.shadowColor = kit.material.rgba(side, .4);
    ctx.shadowBlur = depth*1.35;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = depth*.62;
    ctx.fill(path, spec.rule || 'nonzero');
    ctx.restore();
  }
  ctx.save();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = kit.material.linear(ctx, lightX, y, shadeX+.01, y+h+.01,
    [[0, high], [.52, middle], [1, kit.material.mix(middle, side, .48)]]);
  ctx.fill(path, spec.rule || 'nonzero');
  if ((m.grain ?? .7) > 0) {
    facePaper ??= kit.material.paperTexture(112, 112, 349);
    if (!paperPatterns.has(ctx)) paperPatterns.set(ctx, ctx.createPattern(facePaper, 'repeat'));
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha *= m.grain ?? .7;
    ctx.fillStyle = paperPatterns.get(ctx);
    ctx.fill(path, spec.rule || 'nonzero');
  }
  ctx.restore();
  const lip = m.lip ?? .6;
  if (lip > 0) {
    ctx.save();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = kit.material.linear(ctx, lightX, y, shadeX+.01, y+h+.01,
      [[0, kit.material.rgba(high, lip)], [.58, kit.material.rgba(high, .08*lip)],
       [1, kit.material.rgba(side, .66*lip)]]);
    ctx.lineWidth = m.edgeWidth ?? 1.3;
    ctx.lineJoin = 'round';
    ctx.stroke(path);
    ctx.restore();
  }
}

function paintShape(ctx, kit, spec) {
  const p = pathShape(spec);
  if (spec.material) {
    matteFace(ctx, kit, p, spec);
  } else if (spec.fill) {
    ctx.fillStyle = paint(ctx, kit, spec.fill);
    ctx.fill(p, spec.rule || 'nonzero');
  }
  if (spec.stroke) {
    ctx.strokeStyle = paint(ctx, kit, spec.stroke);
    ctx.lineWidth = spec.lineWidth ?? 1;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash(spec.dash || []);
    ctx.stroke(p);
  }
}

function referenceLightFan(c, kit, x, y, strength) {
  const m = kit.material;
  const rays = [[-2.79,.035,510,.13],[-2.48,.055,620,.19],[-2.22,.030,620,.14],
    [-1.91,.061,700,.20],[-1.65,.038,720,.17],[-1.36,.053,710,.18],
    [-1.04,.042,665,.14],[-.64,.038,530,.10]];
  c.save(); c.globalCompositeOperation='screen'; c.filter='blur(12px)';
  for (const [a, half, length, density] of rays) {
    const endpoint=delta=>[x+Math.cos(a+delta)*length,y+Math.sin(a+delta)*length];
    const [endX,endY]=endpoint(0), opacity=density*strength;
    const color=m.linear(c,x,y,endX,endY,[[0,m.rgba('#ffdfab',.62*opacity)],
      [.26,m.rgba('#fff3d6',opacity)],[.66,m.rgba('#eef4ff',.49*opacity)],[1,m.rgba('#eef4ff',0)]]);
    kit.path.polygon(c,[[x-4,y],endpoint(-half),endpoint(half),[x+4,y]],color);
  }
  c.restore();
}

function landscape(api, spec) {
  const { kit, ctx } = api;
  const house = api.houseMaterials;
  const profileName = spec.material_profile || house?.tone_profiles[spec.tone || 'day'];
  const profile = house?.worlds[profileName];
  if (spec.material_profile && !profile) throw new Error('Unknown shared world material ' + spec.material_profile);
  const viewportFinish = api.plan.project.style_profile === 'illustrated-2-5d';
  const cacheKey = JSON.stringify([spec,profile,viewportFinish]);
  let layer = stages.get(cacheKey);
  if (!layer) {
    layer = createCanvas(1080, 1920);
    const c = layer.getContext('2d');
    c.scale(2, 2);
    const mode = spec.tone || 'day';
    const sky = {
      day: ['#315f96', '#477eaf', '#a6c1d8', '#f3c291'],
      dusk: ['#315586', '#757eab', '#deb6a4', '#f2bd81'],
      dim: ['#223f65', '#426187', '#849cb0', '#c3a891'],
      studio: ['#193454', '#345a81', '#7595ac', '#c0c9ce'],
    }[mode];
    if (!sky) throw new Error('Unknown stage lighting ' + mode);
    const horizon = spec.horizon ?? profile?.sky_extent ?? 693, plane = spec.plane ?? 'full';
    const stops = spec.colors || (profile
      ? profile.sky.map((c,i)=>[profile.sky_y[i]/profile.sky_extent,c])
      : [[0, sky[0]], [.43, sky[1]], [.72, sky[2]], [1, sky[3]]]);
    if (plane === 'sky' || plane === 'full') {
      c.fillStyle = kit.material.linear(c, 0, 0, 0, horizon, stops);
      c.fillRect(0, 0, 540, 960);
      if (spec.rays) {
        if (viewportFinish) referenceLightFan(c,kit,spec.lightX??350,spec.lightY??horizon,clamp(spec.rays/1.60,0,1.32));
        else kit.material.lightRays(c,{x:spec.lightX??350,y:horizon,opacity:spec.rays});
      }
    }
    if (plane !== 'sky' && spec.terrain !== false) {
      if (viewportFinish) c.save();
      c.translate(0, horizon - (profile?.sky_extent ?? 693));
      const nearFill = profile ? {
        from:[0,670],to:[0,960],stops:profile.near,
      } : {
        from:[0,667],to:[0,978],stops:[[0,'#36536e'],[.48,'#263b52'],[1,'#1a2a40']],
      };
      const ridges = [
        [profile?.ridge_paths?.far ?? 'M0 685 C 57 683 92 702 147 691 S 223 686 269 691 S 352 688 411 692 S 492 683 540 688 L540 1100 L0 1100 Z', '#829cc0'],
        [profile?.ridge_paths?.middle ?? 'M0 709 C 51 719 83 701 127 711 S 207 702 271 714 S 353 713 397 705 S 481 711 540 700 L540 1100 L0 1100 Z', '#647e9f'],
        ['M0 728 C 65 751 104 743 157 741 S 258 747 302 730 C 348 716 363 673 412 670 C 452 666 480 720 540 735 L540 1100 L0 1100 Z', nearFill],
      ];
      for (const [i, [d, fill]] of ridges.entries()) {
        const materialFill = profile && i<2
          ? {from:[0,i===0?686:706],to:[0,i===0?712:748],stops:[[0,(i===0?profile.far:profile.middle)[0]],[1,(i===0?profile.far:profile.middle)[1]]]}
          : fill;
        if (plane === 'full' || plane === ['far', 'middle', 'near'][i]) paintShape(c, kit, {d, fill:materialFill});
      }
      if (viewportFinish) c.restore();
    }
    if (profile?.dark && (plane === 'sky' || plane === 'full')) {
      c.fillStyle=`rgba(${profile.dark_rgba.join(',')})`;c.fillRect(0,0,540,960);
    }
    if (profile && (plane === 'full' || plane === 'sky')) kit.material.applyGrain(c,kit.material.paperTexture(),profile.grain);
    stages.set(cacheKey, layer);
  }
  ctx.drawImage(layer, 0, 0, 540, 960);
}

function fillRect(ctx, kit, x, y, w, h, radius, fill, stroke) {
  ctx.save();
  ctx.translate(x, y);
  paintShape(ctx, kit, {w, h, radius, fill, stroke});
  ctx.restore();
}

let formingCloudLayer;
function formingCloud(ctx,kit,spec) {
  formingCloudLayer ??= createCanvas(360,220);
  const c=formingCloudLayer.getContext('2d');c.resetTransform();c.clearRect(0,0,360,220);
  const q=clamp(spec.formation),path=new Path2D();
  const lobes=[[95,116,54,45],[148,87,67,57],[208,84,57,52],[261,118,57,37],[180,140,119,28]];
  const geometry=lobes.map(([x,y,rx,ry],i)=>{
    const f=smooth(clamp((q-i*.025)/Math.max(.01,1-i*.025))),spread=1.75-.75*f,size=.55+.45*f;
    return [180+(x-180)*spread,110+(y-110)*spread,rx*size,ry*size];
  });
  for(const [x,y,rx,ry] of geometry){path.moveTo(x+rx,y);path.ellipse(x,y,rx,ry,0,0,TAU);}
  c.save();c.clip(path);
  c.fillStyle=kit.material.linear(c,0,18,0,171,[[0,'#fffdf6'],[.42,'#f8f4f1'],[.75,'#e2dfeb'],[1,'#b9bdd2']]);c.fillRect(0,0,360,220);
  for(const [x,y,rx,ry] of geometry)kit.material.softEllipse(c,x-rx*.15,y-ry*.3,rx*.95,ry*.85,'#fffdf5',.32);
  kit.material.softEllipse(c,190,167,151,24,'#8d9db8',.18);
  c.restore();kit.material.drawCloud(ctx,formingCloudLayer,0,0,spec.w??380);
}

function cloud(ctx, kit, spec) {
  if(spec.formation != null)return formingCloud(ctx,kit,spec);
  const variant = spec.storm ? 'storm' : 'fair';
  if (!clouds.has(variant)) {
    const layer = createCanvas(288, 156), c = layer.getContext('2d');
    const silhouette = 'M9 124 C1 110 8 87 31 79 C34 57 55 41 80 45 C88 18 113 10 140 19 C159 10 188 23 196 45 C219 43 235 57 240 74 C265 76 283 94 282 115 C282 134 261 141 234 140 C191 134 173 143 141 138 C102 134 78 145 55 140 C33 138 18 141 9 124 Z';
    c.clip(pathShape({d:silhouette}));
    c.fillStyle = kit.material.linear(c, 0, 20, 0, 141, spec.storm
      ? [[0,'#dce2ea'],[.52,'#aeb9cd'],[1,'#7286a4']]
      : [[0,'#fbf7f3'],[.52,'#f4eff0'],[.82,'#e3deeb'],[1,'#c7c2d6']]);
    c.fillRect(0,0,288,156);
    for (const [x,y,rx,ry] of [[52,89,57,45],[109,50,69,49],[171,45,60,47],[229,84,62,42]]) {
      kit.material.softEllipse(c,x,y,rx,ry,spec.storm?'#e6eaf1':'#fffdf6',.42);
    }
    clouds.set(variant, layer);
  }
  const w = spec.w ?? 70;
  kit.material.drawCloud(ctx, clouds.get(variant), 0, 0, w);
}

function glow(ctx, kit, spec) {
  const {rx = 45, ry = rx, tint = 'gold', intensity = .4} = spec;
  kit.material.softEllipse(ctx, 0, 0, rx, ry, color(tint), intensity);
}

function volume(ctx, kit, spec) {
  const points = spec.reveal == null ? spec.points : prefixOfPath(spec.points, spec.reveal);
  if (points.length < 2) return;
  const path = pathShape({points, closed:false});
  const tint = color(spec.tint || 'gold'), light = color(spec.highlight || 'ivory');
  const width = spec.width ?? 27, strength = clamp(spec.intensity ?? .72);
  if (!(width > 0) || strength === 0) return;
  const [x, y] = points[0], [endX, endY] = points.at(-1);
  const closed = Math.hypot(endX-x, endY-y) < .1;
  const gradient = (c, alpha) => kit.material.linear(ctx, x, y,
    closed ? x : endX, closed ? y+width*2 : endY,
    [[0, kit.material.rgba(c, alpha*(spec.tail ?? .25))],
     [.38, kit.material.rgba(c, alpha)], [1, kit.material.rgba(c, alpha*(spec.tip ?? .9))]]);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Approximate a soft cross-section with nested low-opacity contours.
  // Each pass contributes only the opacity missing from the previous pass.
  let opacity = 0;
  const bands=Math.max(12,Math.min(96,Math.round(spec.bands??12)));
  for (let band = bands; band > 0; band--) {
    const radius = band/bands;
    const next = .47*strength*Math.exp(-4.7*radius*radius);
    ctx.strokeStyle = gradient(tint, (next-opacity)/(1-opacity));
    ctx.lineWidth = width*2.4*radius;
    ctx.stroke(path);
    opacity = next;
  }
  ctx.strokeStyle = gradient(light, strength*(spec.core ?? .46));
  ctx.lineWidth = Math.max(1, width*.115);
  ctx.stroke(path);
  ctx.restore();
}

function lightDisc(ctx, kit, spec) {
  const r = spec.r ?? 20;
  glow(ctx, kit, {rx: r * 4, ry: r * 4, tint: spec.halo || 'gold', intensity: spec.intensity ?? .30});
  kit.material.ellipse(ctx, 0, 0, r, r, kit.material.radial(ctx, -r*.18, -r*.27, r*1.46,
    color(spec.fill || '#fff3c7'), 1));
  kit.material.ellipse(ctx, 0, 0, r*.82, r*.82, color(spec.center || '#ffe9b5'), .53);
}

function standing(ctx, kit, spec = {}) {
  const navy = spec.jacket || '#203b52', accent = spec.helmet || '#e5a74f';
  ctx.save();
  ctx.scale(spec.facing ?? 1, 1);
  const seam = '#142b3c';
  kit.material.ellipse(ctx, 0, 7, 18, 4, '#102937', .52);
  paintShape(ctx, kit, {d:'M -5 -31 L 6 -33 L 8 -4 L 12 0 Q 12 6 2 5 L -4 4 Z',fill:seam});
  paintShape(ctx, kit, {d:'M -11 -74 Q -1 -79 9 -68 L 11 -36 Q 5 -29 -9 -32 L -13 -50 Z',fill:navy});
  if (spec.pack) paintShape(ctx, kit, {d:'M -9 -70 Q -20 -72 -21 -61 L -19 -42 Q -14 -35 -8 -39 Z',fill:'#152b41',stroke:'#ba894d',lineWidth:2});
  paintShape(ctx, kit, {d:'M 2 -66 Q 10 -67 11 -56 L 15 -48 L 9 -43 Q 2 -50 1 -56 Z',fill:kit.material.mix(navy,'#889db3',.19)});
  kit.material.ellipse(ctx, 13, -46, 3.2, 4, '#e4c2a2');
  if (spec.reach) {
    const lift = clamp(spec.reach);
    kit.path.strokePath(ctx, [[-7,-64],[-14,-74-lift*9],[-12,-89-lift*11]], navy, 6.2, .98);
    kit.material.ellipse(ctx,-12,-89-lift*11,3.6,3.6,'#e2c29d');
  }
  kit.material.ellipse(ctx, 2, -83, 10.3, 10.5, '#e8c8a3');
  paintShape(ctx, kit, {d:'M -9 -84 C -12 -95 1 -99 9 -91 L 13 -85 Q 1 -86 -9 -84 Z',fill:accent});
  kit.material.ellipse(ctx, 11, -84.5, 4, 2.8, '#192f43');
  ctx.restore();
}

function legacyWingPilot(ctx, kit, spec) {
  const w = spec.w ?? 149, bank = (spec.bank || 0) * Math.PI / 180;
  const dip = spec.dip ?? 23, drop = spec.drop ?? 69, swing = spec.swing || 0;
  const top = x => -dip * (1 - (2*x/w)**2);
  const lower = x => top(x) + 15 - 5*Math.abs(x/(w/2));
  const figureRotation = -bank * .6, size = Math.max(.58, w/150);
  ctx.save();
  ctx.rotate(bank);
  const anchors = [-.47,-.32,-.16,.16,.32,.47];
  for (const u of anchors) {
    const hand = Math.sign(u)*5.2*size;
    const grip = [swing + Math.cos(figureRotation)*hand, drop + Math.sin(figureRotation)*hand];
    kit.path.strokePath(ctx, [[u*w, lower(u*w)-.7], grip], '#344659', .91, .83);
  }
  ctx.beginPath();
  ctx.moveTo(-w/2,top(-w/2));
  ctx.quadraticCurveTo(0, -2*dip, w/2, 0);
  ctx.lineTo(w/2-2, lower(w/2));
  ctx.quadraticCurveTo(0, -2*dip + 22, -w/2+2, lower(-w/2));
  ctx.closePath();
  ctx.fillStyle = kit.material.linear(ctx,0,-dip,0,16,[[0,'#f9ba70'],[.47,'#ed9141'],[1,'#b66a32']]);
  ctx.fill();
  ctx.strokeStyle='#a96235';
  ctx.lineWidth=.65;
  ctx.stroke();
  for (let i=1; i<13; i++) {
    const x = w * (i/13 - .5), bend = x*.015;
    kit.path.strokePath(ctx, [[x,top(x)+2],[x+bend,lower(x)-1]], '#a45b27', 1, .44);
    kit.path.strokePath(ctx, [[x+1,top(x)+2],[x+bend+1,lower(x)-1.6]], '#ffd29c', .7, .42);
  }
  ctx.translate(swing, drop);
  ctx.rotate(figureRotation);
  ctx.scale(size,size);
  for (const side of [-1,1]) {
    kit.path.strokePath(ctx,[[side*4.4,14],[side*5.9,23],[side*6.3,30]],'#15283d',3.4);
    kit.path.strokePath(ctx,[[side*4.1,8],[side*5.2,0]],'#263c51',2.5);
  }
  paintShape(ctx,kit,{d:'M-7 6 Q0 3 7 6 L8 18 Q5 22 -6 21 Q-9 19 -7 6 Z',fill:'#1d3044'});
  kit.material.ellipse(ctx,0,1,6.6,5.2,'#f1dfc6');
  kit.material.ellipse(ctx,0,-1.2,6.1,3.7,'#e9a457');
  ctx.restore();
}

function wingPilot(api,spec) {
  // Older editable projects retain their legacy path; newly compiled recipes
  // always declare and copy the shared component when any nested actor uses it.
  if(!api.shot.asset_ids.includes('paraglider-rig'))return legacyWingPilot(api.ctx,api.kit,spec);
  const w=spec.w??149,pose=[0,0,w,(spec.bank||0)*Math.PI/180,spec.canopy_sy??(spec.dip!==undefined?spec.dip/23:1)];
  const pilot=[(spec.swing||0)/w,(spec.drop??w*.573)/w,(spec.pilot_angle||0)*Math.PI/180];
  return api.component('paraglider-rig').draw({ctx:api.ctx,kit:api.kit,pose,pilot});
}

function legacyGauge(ctx, kit, spec) {
  const r = spec.r ?? 39, q = clamp(spec.level ?? 0);
  kit.material.ellipse(ctx,0,1,r+3,r+3,'#122336',.97);
  kit.material.ellipse(ctx,0,0,r*.56,r*.56,'#e4e8e7');
  for (let i=0; i<13; i++) {
    const a = (138 + i*22)*Math.PI/180;
    kit.path.strokePath(ctx, [[Math.cos(a)*r*.68,Math.sin(a)*r*.68],
      [Math.cos(a)*r*.89,Math.sin(a)*r*.89]], '#cbd7df', 1.25, i%3===0 ? .85 : .46);
  }
  ctx.beginPath();
  ctx.arc(0,0,r*.96,Math.PI*.77,Math.PI*(.77+1.47*q));
  ctx.lineWidth = r*.13;
  ctx.lineCap = 'round';
  ctx.strokeStyle = color(spec.accent || 'amber');
  ctx.stroke();
  const a = Math.PI*(.75+1.5*clamp(spec.needle ?? q));
  kit.path.strokePath(ctx, [[0,0],[Math.cos(a)*r*.48,Math.sin(a)*r*.48]], '#587186', 2.2, .9);
  kit.material.ellipse(ctx,0,0,r*.07,r*.07,'#3a546a');
}

function legacyThermometer(ctx, kit, spec) {
  const h = spec.h ?? 230, level = clamp(spec.level ?? 0), r = spec.r ?? 24;
  paintShape(ctx,kit,{left:-r*.66,top:-h,w:r*1.32,h,radius:r*.66,fill:'#f1f1ed',stroke:'#24374e',lineWidth:2.2});
  kit.material.ellipse(ctx,0,0,r,r,'#263d52');
  kit.material.ellipse(ctx,0,0,r-3,r-3,'#e4e5e1');
  const rise = (h-13)*level;
  fillRect(ctx,kit,-r*.32,-rise-1,r*.64,rise+2,r*.32,'#eaaa53','#cd8e4a');
  kit.material.ellipse(ctx,0,0,r*.7,r*.7,'#f4b25d');
  for (let i=0; i<8; i++) {
    const y=-h+17+i*(h-31)/8;
    kit.path.strokePath(ctx,[[r*.25,y],[r*.55,y]],'#8497a8',1,.78);
  }
}

function mechanism(api,spec,clock) {
 const {ctx,kit}=api;
 if(!api.shot.asset_ids.includes('thermal-mechanisms'))return spec.kind==='gauge'?legacyGauge(ctx,kit,spec):legacyThermometer(ctx,kit,spec);
 const renderer=api.component('thermal-mechanisms'),style=api.data('mechanism-style');
 const rtl=/^(fa|ar|ur)(-|$)/i.test(api.plan.project.language.resolved.screen_text),font=rtl?'Motion Persian Bold':'Reel Reference Bold';
 if(spec.kind==='boiling-pan')return renderer.drawPan({ctx,kit,style,w:spec.w??290,time:spec.frozen?0:(spec.time??clock.local),bubble_time:spec.bubble_time,water_time:spec.water_time,steam_time:spec.steam_time,flame_time:spec.flame_time,heat:spec.heat??1,count:spec.count,seed:spec.seed});
 if(spec.kind==='gauge')return renderer.drawGauge({ctx,kit,style,r:spec.r??39,level:spec.level??0,needle:spec.needle,labels:spec.labels?(Array.isArray(spec.labels)?spec.labels:rtl?['کم','زیاد']:['LOW','MAX']):false,font,accent:spec.accent?color(spec.accent):undefined});
 return renderer.drawThermometer({ctx,kit,style,h:spec.h??230,r:spec.r??24,level:spec.level??0,cool:spec.cool??0,label:spec.label??(spec.labels?(rtl?'هوا':'AIR'):undefined),font});
}

function emission(api, spec, t) {
  const {ctx,kit}=api;
  const { count=16, seed=25, w=140, h=100, period=2.4, tint='ivory' } = spec;
  const random = kit.flow.seeded(seed);
  for (let i=0; i<count; i++) {
    const u=random(), delay=random(), size=(spec.r ?? 4)*(.55+random());
    const q=wrap(t/period+delay,1), a=Math.sin(Math.PI*q);
    const x=(u-.5)*w + Math.sin(q*TAU+delay*4)*(spec.drift ?? 8);
    const y=h*(.5-q);
    if (spec.mode === 'bubbles') {
      if(api.shot.asset_ids.includes('thermal-mechanisms'))api.component('thermal-mechanisms').drawBubble({ctx,kit,style:api.data('mechanism-style'),x,y,r:size,alpha:a,fill:.10+.32*q,mature:q>.74&&size>6});
      else {kit.material.ellipse(ctx,x,y,size,size,color(tint),a*.18);ctx.beginPath();ctx.arc(x,y,size,0,TAU);ctx.lineWidth=1;ctx.strokeStyle=kit.material.rgba(color(tint),a*.45);ctx.stroke();}
    } else {
      kit.material.softEllipse(ctx,x,y,size*2.7,size*2.7,color(tint),a*.54);
    }
  }
}

function arrow(ctx, kit, spec) {
  const length=spec.length ?? 46, w=spec.thickness ?? 8, tip=length*.24;
  const c=color(spec.fill || 'amber');
  paintShape(ctx,kit,{points:[[-w/2,length/2],[w/2,length/2],[w/2,-length/2+tip],
    [w*1.24,-length/2+tip],[0,-length/2],[-w*1.24,-length/2+tip],[-w/2,-length/2+tip]],
    fill:{from:[0,-length/2],to:[0,length/2],stops:[[0,c],[1,kit.material.rgba(c,spec.tail??.7)]]}});
}

function flow(api,spec,clock) {
 const {ctx,kit}=api,mod=api.component('thermal-flow'),style=api.data('flow-style');
 if(spec.kind==='arrow')return mod.drawArrow({ctx,kit,style,dir:spec.dir??1,length:spec.length??53,thickness:spec.thickness??8,tint:spec.fill?color(spec.fill):undefined});
 if(spec.kind==='parcel')return mod.drawParcel({ctx,kit,style,r:spec.r??42,power:spec.power??1,cool:spec.cool??0,profile:spec.profile??'rise'});
 return mod.drawWarmAir({ctx,kit,style,...spec,x:0,y:0,time:spec.time??clock.local,opacity:spec.intensity??1});
}

function title(api, spec) {
  const {ctx, kit, localTime, plan} = api;
  const language=plan.project.language.resolved.screen_text, rtl=/^(fa|ar|ur)(-|$)/i.test(language);
  const type=rtl ? '"Motion Persian Bold"' : '"Reel Reference Bold"';
  const size=spec.size ?? 55, gap=spec.lineGap ?? size*1.01, y=spec.y ?? 176;
  const shared=api.shot.asset_ids.includes('type-motion')&&spec.motion_profile!=='legacy';
  const motion=shared?api.component('type-motion'):null,style=shared?api.data('type-style'):null;
  const [start, end]=spec.reveal || [0,shared?.5:.24];
  const reveal = ([a,b]) => smooth(clamp((localTime-a)/Math.max(.01,b-a)));
  const hold = spec.hide ? 1-smooth(clamp((localTime-spec.hide[0])/Math.max(.01,spec.hide[1]-spec.hide[0]))) : 1;
  const fade = hold*(api.headingOpacity ?? 1);
  if (fade <= 0) return;
  ctx.save();
  ctx.globalAlpha *= fade;
  ctx.font = `bold ${size}px ${type}`;
  ctx.shadowColor='rgba(15,31,49,.36)';
  ctx.shadowBlur=3;
  ctx.shadowOffsetY=2;
  ctx.__recordDraw?.('text.heading');
  const swatches = spec.accents || {};
  for (const [i, line] of (spec.lines || []).entries()) {
    const interval=spec.lineReveals?.[i] || [start,end];
    const pose=shared?motion.pose(style,(localTime-interval[0])*15/Math.max(.01,interval[1]-interval[0]),{role:'headline'}):null;
    const q = pose?.alpha ?? reveal(interval);
    if (q <= 0) continue;
    const parts = Array.isArray(line) ? line : [line];
    const words = parts.map(part=>typeof part==='string'?part:part.text).join('');
    const glyphMetrics=ctx.measureText(words),width=glyphMetrics.width;
    const glyphDescent=Math.max(0,glyphMetrics.actualBoundingBoxDescent||0);
    const underlineY=glyphDescent+(spec.underline_clearance??4),underlineThickness=spec.underline_thickness??5;
    const reportUnderline=(left,advance,p)=>{if(ctx.__motionTitleUnderline&&p>0){const t=ctx.getTransform();ctx.__motionTitleUnderline({shot:api.shot.id,line:i,alpha:ctx.globalAlpha,reveal:p,bounds:[t.a*left+t.c*underlineY+t.e,t.b*left+t.d*underlineY+t.f,t.a*(left+advance)+t.c*(underlineY+underlineThickness)+t.e,t.b*(left+advance)+t.d*(underlineY+underlineThickness)+t.f],glyph_bottom:t.d*glyphDescent+t.f,clearance:t.d*(underlineY-glyphDescent),thickness:t.d*underlineThickness});}};
    const scale=pose?.scale ?? (1+(spec.pop??.18)*(1-q)**3);
    const squeeze=Math.min(1,((spec.maxWidth??476)-8)/Math.max(1,width*scale));
    ctx.save();
    ctx.globalAlpha *= q;
    const centre=y+gap*((spec.lines?.length||1)-1)/2-size*.35;
    const baseline=y+gap*i;
    ctx.translate(spec.x ?? 270, baseline+(shared&&spec.lines.length>1?(baseline-centre)*(scale-1):0));
    ctx.scale(squeeze*scale,scale);
    ctx.textBaseline='alphabetic';
    const accents = [];
    if (rtl) {
      ctx.direction=spec.lineDirections?.[i]||'rtl'; ctx.textAlign='center';
      const tint=parts.find(p=>typeof p==='object'&&p.color)?.color;
      ctx.fillStyle=color(tint||spec.color||'ivory');ctx.fillText(words,0,0);
      if(ctx.__motionTitleBounds){const m=ctx.measureText(words),t=ctx.getTransform();const pts=[[-m.width/2-4,-m.actualBoundingBoxAscent],[m.width/2+4,m.actualBoundingBoxDescent]].map(([x,y])=>[t.a*x+t.c*y+t.e,t.b*x+t.d*y+t.f]);ctx.__motionTitleBounds({shot:api.shot.id,line:i,alpha:ctx.globalAlpha,bounds:[pts[0][0],pts[0][1],pts[1][0],pts[1][1]],fontSize:size*scale*squeeze});}
      if(tint&&words.trim())accents.push([-width/2,width]);
    } else {
      ctx.textAlign='left';
      let left=-width/2;
      for (const part of parts) {
        const s=typeof part==='string'?part:part.text;
        const tint=(typeof part==='object' && part.color) || swatches[s];
        ctx.fillStyle=color(tint || spec.color || 'ivory');
        ctx.fillText(s,left,0);
        const advance=ctx.measureText(s).width;
        if (tint && s.trim()) accents.push([left+ctx.measureText(s.match(/^\s*/)[0]).width,ctx.measureText(s.trim()).width]);
        left+=advance;
      }
    }
    if (spec.underline === i) {
      const p = smooth(clamp((localTime-end)/.20));
      ctx.fillStyle = color('amber');
      const referenceStyle = ['matte-reference','illustrated-2-5d'].includes(plan.project.style_profile);
      ctx.fillRect(-width/2,underlineY,width*p,underlineThickness);reportUnderline(-width/2,width*p,p);
    }
    if (spec.underline === 'accent') {
      const p=smooth(clamp((localTime-(spec.lineReveals?.[i]?.[1] ?? end))/.20));
      ctx.fillStyle=color('amber');
      for (const [left, advance] of accents){ctx.fillRect(left,underlineY,advance*p,underlineThickness);reportUnderline(left,advance*p,p);}
    }
    ctx.restore();
  }
  if (spec.support) {
    const p=shared&&spec.supportAt===undefined?motion.pose(style,localTime*30,{role:'support'}).alpha:smooth(clamp((localTime-(spec.supportAt??end))/.22));
    kit.text.label(ctx,spec.support,spec.x??270,y+gap*((spec.lines?.length||1)-1)+(spec.supportGap??39),
      {align:'center',size:spec.supportSize??22,alpha:p});
  }
  ctx.restore();
}

function composite(api, nodes, program, clock, depth) {
  const {ctx, kit} = api;
  const width = ctx.canvas.width, height = ctx.canvas.height;
  let layer = compositeLayers[depth];
  if (!layer || layer.width !== width || layer.height !== height) {
    layer = createCanvas(width,height);
    compositeLayers[depth] = layer;
  }
  const part = layer.getContext('2d');
  part.resetTransform();
  part.clearRect(0,0,width,height);
  part.setTransform(ctx.getTransform());
  part.__recordDraw = ctx.__recordDraw;
  const language = api.plan.project.language.resolved.screen_text;
  kit.text.configureContext(part,kit.text.typographyFor(language,/^en(-|$)/i.test(language)
    ? {regularStack:'"Reel Reference Sans"',boldStack:'"Reel Reference Bold"',lineHeight:1.1} : {}));
  draw({...api,ctx:part},nodes,program,clock,depth+1);
  ctx.resetTransform();
  ctx.drawImage(layer,0,0);
}

function draw(api, nodes, program, clock, depth=0) {
  const { ctx, kit } = api;
  for (const raw of nodes) {
    const s = Object.fromEntries(Object.entries(raw).map(([key, v]) => [key, value(v, clock)]));
    if ((s.alpha ?? 1) <= 0) continue;
    ctx.save();
    if(s.screen_space && api.headingTransform)ctx.setTransform(api.headingTransform);
    ctx.globalAlpha *= clamp(s.alpha ?? 1);
    if(s.language==='en'){kit.text.configureContext(ctx,kit.text.typographyFor('en',{regularStack:'\"Reel Reference Sans\"',boldStack:'\"Reel Reference Bold\"'}));ctx.__recordDraw?.('font.Reel Reference Bold');}
    ctx.translate(s.x || 0, s.y || 0);
    ctx.rotate((s.rotation || 0)*Math.PI/180);
    ctx.scale(s.sx ?? s.scale ?? 1, s.sy ?? s.scale ?? 1);
    if (s.blur > 0) ctx.filter=`blur(${s.blur}px)`;
    if (s.clip) ctx.clip(pathShape(s.clip), s.clip.rule || 'nonzero');
    if (s.shadow) {
      ctx.shadowColor=s.shadow.color || 'rgba(16,33,50,.35)';
      ctx.shadowBlur=s.shadow.blur ?? 6;
      ctx.shadowOffsetX=s.shadow.x ?? 1;
      ctx.shadowOffsetY=s.shadow.y ?? 3;
    }
    switch (s.kind) {
      case 'shape': paintShape(ctx,kit,s); break;
      case 'group':
      case 'instance': {
        const children = s.kind === 'group' ? s.layers : program.objects[s.object];
        const timing = s.kind === 'group' ? clock : {...clock,local:clock.local+(s.phase||0)};
        if (s.composite && (ctx.globalAlpha < 1 || s.blur || s.shadow)) {
          composite(api,children,program,timing,depth);
        } else {
          draw(api,children,program,timing,depth);
        }
        break;
      }
      case 'landscape': landscape(api,s.world || {}); break;
      case 'image': {
        const im=api.image(s.asset), w=s.w ?? im.width, h=s.h ?? w*im.height/im.width;
        if (s.cover) kit.material.drawCover(ctx,im,s.left ?? 0,s.top ?? 0,w,h);
        else ctx.drawImage(im,s.left ?? -w/2,s.top ?? -h/2,w,h);
        break;
      }
      case 'cloud': cloud(ctx,kit,s); break;
      case 'weather-cloud':
      case 'relief':
      case 'air-path':
      case 'air-mass':
      case 'droplets':
      case 'fog-bank':
      case 'callout':
      case 'follow-chip': api.component('weather-parts').draw(api,s,clock);break;
      case 'glow': glow(ctx,kit,s); break;
      case 'volume': volume(ctx,kit,s); break;
      case 'parcel': if(api.shot.asset_ids.includes('thermal-flow'))flow(api,s,clock);else kit.material.warmParcel(ctx,0,0,s.r??42,s.cool??0);break;
      case 'warm-air': flow(api,s,clock);break;
      case 'light-disc': lightDisc(ctx,kit,s); break;
      case 'rays': kit.material.lightRays(ctx,{x:0,y:0,opacity:s.intensity??.5}); break;
      case 'standing': standing(ctx,kit,s); break;
      case 'wing-pilot': wingPilot(api,s); break;
      case 'boiling-pan':
      case 'gauge': mechanism(api,s,clock); break;
      case 'thermometer': mechanism(api,s,clock); break;
      case 'emit': emission(api,s,clock.local); break;
      case 'arrow': if(api.shot.asset_ids.includes('thermal-flow'))flow(api,s,clock);else arrow(ctx,kit,s);break;
      case 'label': kit.text.label(ctx,s.text,0,0,{size:s.size??18,align:s.align??'center',color:color(s.fill||'ivory')}); break;
      case 'pill': {
        kit.text.pill(ctx,s.text,0,0,{fill:color(s.fill||'ink'),color:color(s.textColor||'ivory'),size:s.size??15,pad:s.pad??16});
        ctx.__recordDraw?.('text.label');
        break;
      }
      default: throw new Error('Unknown scenario layer ' + s.kind);
    }
    ctx.restore();
    if(s.language==='en')kit.text.configureContext(ctx,kit.text.typographyFor(api.plan.project.language.resolved.screen_text));
  }
}

let grain;
function drawScene(api) {
  if (api.plan.assets.some(asset=>asset.id==='house-materials')) api.houseMaterials=api.data('house-materials');
  const program=api.data(api.shot.renderer.graph);
  const shot=program.shots[api.shot.id];
  if (!shot) throw new Error('Scenario graph has no shot ' + api.shot.id);
  const clock={local:api.localTime,time:api.time,eventTime:api.eventTime};
  draw(api,shot.layers,program,clock);
  if (shot.grain !== 0) {
    grain ??= api.kit.material.paperTexture();
    api.kit.material.applyGrain(api.ctx,grain,shot.grain ?? .28);
  }
  if (shot.title) {
    api.ctx.save();
    if (api.headingTransform) api.ctx.setTransform(api.headingTransform);
    title(api,shot.title);
    api.ctx.restore();
  }
}

module.exports={drawScene,value};
