'use strict';
function sample(keys,frame){
 if(frame<=keys[0][0])return {alpha:keys[0][1],scale:keys[0][2]};
 for(let i=1;i<keys.length;i++)if(frame<=keys[i][0]){const a=keys[i-1],b=keys[i],q=(frame-a[0])/(b[0]-a[0]);return {alpha:a[1]+q*(b[1]-a[1]),scale:a[2]+q*(b[2]-a[2])};}
 const last=keys.at(-1);return {alpha:last[1],scale:last[2]};
}
function pose(style,frame,{scene,line=0,role='headline'}={}){
 return sample(style.scenes?.[scene]?.lines?.[line]?.keys||style.shared[role],frame);
}
module.exports={sample,pose};
