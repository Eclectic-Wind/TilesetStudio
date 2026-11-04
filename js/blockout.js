// Procedural object colors for the existing Add and Free Draw tools. Painted art stays separate.
"use strict";
(() => {
 const B = TS.Blockout = {}, M = TS.Mesh;
 B.color = o => /^#[\da-f]{6}$/i.test(o.blockoutColor || "") ? o.blockoutColor : "#b87864";
 B.rgb = o => B.color(o).slice(1).match(/../g).map(x => parseInt(x,16) / 255);
 B.process = (objects, art, settings) => {
  // Reuse the native depth raster; coverage comes from geometry, not source-image alpha.
  const clean={...settings,fill:0,relief:0,cavity:0};
  const blank={w:art.w,h:art.h,data:new Uint8ClampedArray(art.w*art.h*4),alpha:new Uint8Array(art.w*art.h)};
  const r=TS.Process.run(objects,blank,clean),data=blank.data,alpha=blank.alpha;
  const colors=objects.map(B.rgb); let covered=0,over=0;
  for(let i=0;i<r.owner.length;i++){
   const oi=r.owner[i];if(oi<0)continue;
   const nz=r.normal[i*3+2],nx=r.normal[i*3],ny=r.normal[i*3+1];
   const shade=nz>.7?1:ny>.5?.82:nx>.5?.68:.76;
   for(let k=0;k<3;k++)data[i*4+k]=Math.round(colors[oi][k]*shade*255);
   data[i*4+3]=alpha[i]=255;covered++;if(r.height[i]>255)over++;
  }
  r.art=blank;r.alpha=alpha;r.stats={covered,holes:0,filled:0,unfilled:0,unused:0,over};r.blockout=true;
  const proj=TS.Proj.of(settings,art);
  r.outside=objects.filter(o=>o.verts.some(v=>{const p=proj.toCanvas(v);return p[0]<0||p[1]<0||p[0]>art.w||p[1]>art.h;})).length;
  return r;
 };
 // Export can fit the whole layout without moving the scene or resizing painted art.
 B.fit = (objects, art, settings, margin=16) => {
  const proj=TS.Proj.of(settings,art);let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const o of objects)for(const v of o.verts){const p=proj.toCanvas(v);minX=Math.min(minX,p[0]);minY=Math.min(minY,p[1]);maxX=Math.max(maxX,p[0]);maxY=Math.max(maxY,p[1]);}
  if(!Number.isFinite(minX))throw Error('No geometry to export.');
  const w=Math.max(1,Math.ceil(maxX-minX)+2*margin),h=Math.max(1,Math.ceil(maxY-minY)+2*margin);
  if(w>4096||h>4096)throw Error('The fitted image exceeds 4096 px. Reduce the layout scale or export a smaller scene.');
  const dx=margin-minX,dy=margin-minY,opts={...settings};let models=objects;
  if(proj.kind==='iso')opts.isoOrigin=[proj.toCanvas([0,0,0])[0]+dx,proj.toCanvas([0,0,0])[1]+dy];
  else models=objects.map(o=>({...o,verts:o.verts.map(v=>[v[0]+dx,v[1]+dy,v[2]])}));
  return B.process(models,{w,h},opts);
 };
 // Anchors use a plane basis, so a box stays rectangular on the floor at any iso tilt.
 B.anchor = (origin, normal) => {
  const n=TS.v3.norm(normal),u=TS.v3.norm(TS.v3.cross(Math.abs(n[2])<.9?[0,0,1]:[0,1,0],n)),v=TS.v3.norm(TS.v3.cross(n,u));
  return {origin:origin.slice(),normal:n,u,v};
 };
 B.point = (a,p) => TS.v3.add(a.origin,TS.v3.add(TS.v3.scale(a.u,p[0]),TS.v3.scale(a.v,p[1])));
 B.sample = (a,ray,snap=0) => {
  const den=TS.v3.dot(ray.d,a.normal);if(Math.abs(den)<1e-6)return null;
  const t=TS.v3.dot(TS.v3.sub(a.origin,ray.o),a.normal)/den;if(t<0)return null;
  const rel=TS.v3.sub(TS.v3.add(ray.o,TS.v3.scale(ray.d,t)),a.origin);
  let screen=[TS.v3.dot(rel,a.u),TS.v3.dot(rel,a.v)];if(snap>0)screen=screen.map(x=>TS.snap(x,snap));
  return {screen,point:B.point(a,screen),normal:a.normal.slice()};
 };
 B.extrude = (input,anchor,options={}) => {
  let p=TS.Shape.simplify(input,options.simplify||0);
  if(options.snap>0)p=TS.Shape.clean(p.map(v=>v.map(x=>TS.snap(x,options.snap))));
  TS.Shape.validate(p);if(options.radius>0){p=TS.Shape.roundCorners(p,options.radius);TS.Shape.validate(p);}
  if(TS.Shape.area(p)<0)p.reverse();
  const h=Number(options.thickness??8);if(!Number.isFinite(h)||h<0||h>255)throw Error('Thickness must be between 0 and 255 px.');
  const n=p.length,back=p.map(q=>B.point(anchor,q)),front=back.map(q=>TS.v3.add(q,TS.v3.scale(anchor.normal,h||.01)));
  const o=M.newObject('Custom shape',front.concat(h?back:[]),[]),top=p.map((_,i)=>i);
  o.faces=[{v:top}];if(h){o.faces.push({v:top.map(i=>i+n).reverse()});for(let i=0;i<n;i++){const j=(i+1)%n;o.faces.push({v:[i+n,j+n,j,i]});}}
  o.basis=[anchor.u.slice(),anchor.v.slice(),anchor.normal.slice()];o.smooth=0;o.solid=h>0;o.collision=h?'footprint':'none';return o;
 };
})();
