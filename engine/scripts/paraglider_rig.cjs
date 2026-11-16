'use strict';
// One deterministic rig for measured and scenario-authored flight. Coordinates
// are in the 540x960 design space. Canopy bank and pilot angle are independent.
const PROFILE=[[-.505,.127,.147],[-.48,.11,.167],[-.42,.068,.16],[-.36,.033,.123],[-.3,.007,.095],[-.24,-.012,.079],[-.18,-.028,.064],[-.12,-.034,.054],[-.06,-.04,.05],[0,-.042,.049],[.06,-.042,.049],[.12,-.036,.054],[.18,-.027,.064],[.24,-.013,.077],[.3,.006,.095],[.36,.03,.121],[.42,.064,.158],[.48,.106,.171],[.505,.124,.149]];
const ATTACHMENTS=[-.48,-.345,-.17,.17,.345,.48];
function edgeAt(profile,u,column){
 if(u<=profile[0][0])return profile[0][column];
 for(let i=1;i<profile.length;i++)if(u<=profile[i][0]){const a=profile[i-1],b=profile[i],q=(u-a[0])/(b[0]-a[0]);return a[column]+q*(b[column]-a[column]);}
 return profile.at(-1)[column];
}
function resolveRig(pose,pilot=null,profile=PROFILE){
 const [x=0,y=0,w=149,bank=0,sy=1]=pose;
 if(![x,y,w,bank,sy].every(Number.isFinite)||w<=0||sy<=0)throw new Error('Invalid paraglider pose.');
 const [dx=0,dy=.573,angle=0]=pilot||[],size=w/150,cs=Math.cos(bank),sn=Math.sin(bank),pc=Math.cos(angle),ps=Math.sin(angle);
 if(![dx,dy,angle].every(Number.isFinite))throw new Error('Invalid independent pilot pose.');
 const body=[x+dx*w,y+dy*w];
 const canopyPoint=(u,v)=>[x+w*(u*cs-v*sy*sn),y+w*(u*sn+v*sy*cs)];
 const bodyPoint=(u,v)=>[body[0]+size*(u*pc-v*ps),body[1]+size*(u*ps+v*pc)];
 const grips={left:bodyPoint(-5.2,-5),right:bodyPoint(5.2,-5)};
 const lines=ATTACHMENTS.map(u=>({u,start:canopyPoint(u,edgeAt(profile,u,2)),end:grips[u<0?'left':'right']}));
 return {x,y,w,bank,sy,size,angle,body,grips,lines,bodyPoint,canopyPoint};
}
function smoothEdge(ctx,edge){
 for(let i=1;i<edge.length-1;i++){const a=edge[i],b=edge[i+1];ctx.quadraticCurveTo(a[0],a[1],(a[0]+b[0])/2,(a[1]+b[1])/2);}
 ctx.lineTo(...edge.at(-1));
}
function draw({ctx,kit,pose,pilot=null,profile=PROFILE}){
 const r=resolveRig(pose,pilot,profile);
 for(const cable of r.lines)kit.path.strokePath(ctx,[cable.start,cable.end],'#2c3643',r.w*.0077,.82);
 const upper=profile.map(([u,top])=>[u,top]),lower=profile.map(([u,top,bottom])=>[u,bottom]);
 ctx.save();ctx.translate(r.x,r.y);ctx.rotate(r.bank);ctx.scale(r.w,r.w*r.sy);
 ctx.beginPath();ctx.moveTo(...upper[0]);smoothEdge(ctx,upper);ctx.lineTo(...lower.at(-1));smoothEdge(ctx,[...lower].reverse());ctx.closePath();
 ctx.fillStyle=kit.material.linear(ctx,0,-.05,0,.179,[[0,'#fbb575'],[.31,'#f3a15a'],[.67,'#e18b45'],[1,'#ba6739']]);ctx.fill();
 ctx.strokeStyle='#9c623f';ctx.lineWidth=.0075;ctx.stroke();
 for(const u of [-.422,-.296,-.153,0,.153,.296,.422]){const top=edgeAt(profile,u,1),bottom=edgeAt(profile,u,2);kit.path.curve(ctx,[[u,top],[u+.008,top+(bottom-top)*.3],[u-.002,bottom-.02],[u*.988,bottom]],'#98552d',.007,.63);}
 ctx.restore();ctx.save();ctx.translate(...r.body);ctx.rotate(r.angle);ctx.scale(r.size,r.size);
 for(const side of [-1,1])kit.path.strokePath(ctx,[[side*4.2,6],[side*5.2,-5]],'#233142',2.4);
 ctx.fillStyle='#233142';ctx.beginPath();ctx.roundRect(-5.4,-1,10.8,20,2.8);ctx.fill();
 kit.path.strokePath(ctx,[[-2.9,16],[-3.6,24]],'#172436',3.6);kit.path.strokePath(ctx,[[2.9,16],[3.5,23]],'#172436',3.6);
 kit.material.ellipse(ctx,0,-6.4,4.6,4,'#d09153');ctx.fillStyle='#f4e3cb';ctx.beginPath();ctx.roundRect(-4.8,-4.4,9.6,4.8,1.6);ctx.fill();
 ctx.restore();return r;
}
module.exports={PROFILE,ATTACHMENTS,edgeAt,resolveRig,draw};
