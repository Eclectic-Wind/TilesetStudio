// Run with node tools/test_blockout.js. No third-party dependencies.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),os=require('node:os'),cp=require('node:child_process'),zlib=require('node:zlib');
const root=path.join(__dirname,'..'),ctx={console,btoa};ctx.window=ctx;vm.createContext(ctx);
for(const f of ['math','proj','shape','mesh','carve','process','blockout','bundle'])vm.runInContext(fs.readFileSync(path.join(root,'js',f+'.js'),'utf8'),ctx,{filename:f+'.js'});
const {Blockout:B,Mesh:M,Proj,Process:P,v3,Carve}=ctx.TS;
let count=0;const check=(name,fn)=>{fn();count++;console.log('PASS '+name);};
const plain=x=>JSON.parse(JSON.stringify(x)),near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
const bounds=o=>[0,1,2].map(k=>{const a=o.verts.map(v=>v[k]);return [Math.min(...a),Math.max(...a)];});
const art={w:256,h:256,data:new Uint8ClampedArray(256*256*4),alpha:new Uint8Array(256*256)};
art.data.set([233,17,55,255]);art.alpha[0]=255;
const boxAt=(c,w=64,d=64,h=4)=>M.box([c[0]+w/2,c[1]+d/2,c[2]],w,d,h);
const settings={...P.defaultSettings(),projection:'iso',isoTilt:26,isoOrigin:[128,80],blockout:true};
check('colored raster covers geometry without mutating painted source',()=>{
 const before=Buffer.from(art.data),saved=JSON.stringify(settings),o=boxAt([0,0,0]);o.blockoutColor='#24a8e0';
 const r=B.process([o],art,settings);assert.ok(r.stats.covered>1000);assert.equal(r.stats.unfilled,0);assert.ok(r.alpha.some(a=>a===0));
 const top=Array.from(r.owner).findIndex((owner,i)=>owner===0 && r.normal[i*3+2]>.99);assert.ok(top>=0);assert.deepEqual(Array.from(r.art.data.slice(top*4,top*4+4)),[36,168,224,255]);
 assert.deepEqual(Buffer.from(art.data),before);assert.equal(JSON.stringify(settings),saved);
 assert.deepEqual(plain(P.worldNormal(r,top,settings)),Array.from(r.normal.slice(top*3,top*3+3)));
 const moved=M.cloneNew(o);M.translate(moved,moved.verts.map((_,i)=>i),[80,0,0]);assert.equal(moved.blockoutColor,o.blockoutColor);
 const r2=B.process([moved],art,settings);assert.equal(r2.alpha[top],0);assert.ok(r2.stats.covered>0);
 const cleared=B.process([],art,settings);assert.equal(cleared.stats.covered,0);assert.ok(cleared.alpha.every(a=>a===0));
});
check('26 degree iso depth picks the front object and its color',()=>{
 const back=boxAt([0,0,0]),front=M.cloneNew(back);back.blockoutColor='#ff0000';front.blockoutColor='#00ff00';
 M.translate(front,front.verts.map((_,i)=>i),v3.scale(Proj.of(settings,art).dir,10));
 const r=B.process([back,front],art,settings);assert.ok(Array.from(r.owner).some(x=>x===1));assert.ok(Array.from(r.owner).every(x=>x!==0));
});
check('fit export includes off-canvas geometry and preserves positions/settings',()=>{
 const objects=[boxAt([-400,500,0],64,8,96),M.wedge([-250,580,0],64,128,64)];const before=JSON.stringify({objects,settings});
 const clipped=B.process(objects,art,settings);assert.equal(clipped.outside,2);
 const r=B.fit(objects,art,settings);assert.ok(r.stats.covered>0);assert.equal(r.outside,0);assert.equal(JSON.stringify({objects,settings}),before);
 assert.throws(()=>B.fit([],art,settings),/No geometry/);
 assert.throws(()=>B.fit([boxAt([0,0,0]),boxAt([5000,0,0])],art,settings),/4096/);
 const old={...settings,projection:'oblique'};assert.equal(B.fit(objects,art,old).outside,0);
});
check('iso plane sampling remains exact across tilts, walls, sloped faces and snapping',()=>{
 for(const tilt of [10,26,45,80])for(const n of [[0,0,1],[1,0,0],[0,1,0],v3.norm([1,2,3])]){
  const proj=Proj.iso([128,80],tilt),a=B.anchor([16,24,8],n),p=B.point(a,[23,41]);
  const ray={o:v3.add(p,v3.scale(proj.dir,1000)),d:v3.scale(proj.dir,-1)},hit=B.sample(a,ray,0);assert.ok(hit);near(v3.dist(hit.point,p),0);
  const sn=B.sample(a,ray,8);assert.deepEqual(plain(sn.screen),[24,40]);near(v3.dot(v3.sub(sn.point,a.origin),a.normal),0);
 }
 const a=B.anchor([0,0,0],[0,0,1]);assert.equal(B.sample(a,{o:[0,0,4],d:[1,0,0]}),null);assert.equal(B.sample(a,{o:[0,0,4],d:[0,0,1]}),null);
});
check('freeform extrusion handles concave polygons, reverse winding, rounded corners and zero thickness',()=>{
 const p=[[0,0],[32,0],[32,16],[16,16],[16,32],[0,32]],a=B.anchor([12,24,8],[0,0,1]);
 for(const poly of [p,p.slice().reverse()]){const o=B.extrude(poly,a,{thickness:8});near(Carve.volume(o),768*8);assert.equal(M.faceTriangles(o,o.faces[0]).length,4);}
 const r=B.extrude([[0,0],[64,0],[64,64],[0,64]],a,{thickness:12,radius:8});assert.ok(r.verts.length>8);assert.ok(Carve.volume(r)>0);
 const wall=B.extrude(p,B.anchor([0,12,0],[0,1,0]),{thickness:6});near(Carve.volume(wall),768*6);
 const zero=B.extrude(p,a,{thickness:0});assert.equal(zero.faces.length,1);assert.equal(zero.collision,'none');
 assert.throws(()=>B.extrude(p,a,{thickness:-1}));assert.throws(()=>B.extrude([[0,0],[32,32],[0,32],[32,0]],a,{thickness:8}));
});
check('native projection self-checks still pass',()=>{assert.ok(Proj.test().every(s=>s.startsWith('ok')),Proj.test().join('\n'));});
check('large floor footprint exports without spreading a huge array onto the call stack',()=>{
 const bigArt={w:512,h:512,data:new Uint8ClampedArray(512*512*4),alpha:new Uint8Array(512*512)};
 const o=M.box([256,256,0],480,480,4);o.kind='floor';o.collision='none';const opts={...settings,projection:'oblique'};
 const r=B.process([o],bigArt,opts);r.pieceMap=P.pieces([o],r,opts);assert.ok(P.footprints([o],bigArt,r,opts).objects.length===1);
});
check('headless bundle embeds generated colors; legacy bundle keeps source atlas bytes',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'tileset-blockout-'));
 try{
  // Valid 1 x 1 opaque PNG input; geometry is fitted into a small oblique canvas below.
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
  const obj=M.box([.5,.5,0],1,1,1);obj.blockoutColor='#24a8e0';
  const project={format:'tileset-studio',name:'qa',tileset:'data:image/png;base64,'+png,objects:[obj],settings:{...P.defaultSettings(),blockout:true}};
  const input=path.join(tmp,'qa.studio.json'),out=path.join(tmp,'qa.export.json');
  fs.writeFileSync(input,JSON.stringify(project));cp.execFileSync(process.execPath,[path.join(__dirname,'export_project.js'),input,out]);
  const bundle=JSON.parse(fs.readFileSync(out));assert.notEqual(bundle.images.atlas,project.tileset);const bytes=Buffer.from(bundle.images.atlas.split(',')[1],'base64');let p=8,parts=[];
  while(p<bytes.length){const n=bytes.readUInt32BE(p),tag=bytes.toString('ascii',p+4,p+8);if(tag==='IDAT')parts.push(bytes.subarray(p+8,p+8+n));p+=n+12;}
  const rgba=zlib.inflateSync(Buffer.concat(parts));assert.equal(rgba[4],255);assert.ok(rgba[3]>rgba[1]);assert.equal(bundle.projection.type,'oblique');
  project.settings.blockout=false;fs.writeFileSync(input,JSON.stringify(project));cp.execFileSync(process.execPath,[path.join(__dirname,'export_project.js'),input,out]);assert.equal(JSON.parse(fs.readFileSync(out)).images.atlas,project.tileset);
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
console.log(`\n${count} blockout checks passed.`);
