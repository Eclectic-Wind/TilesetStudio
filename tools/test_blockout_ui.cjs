// Simulated-browser integration checks. npm install --no-save jsdom@26 pngjs@7
// Canvas/WebGL calls are mocked: this does NOT validate visual GPU output.
'use strict';
const {JSDOM}=require('jsdom'),{PNG}=require('pngjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const dom=new JSDOM(html,{runScripts:'outside-only',url:'http://localhost/'}),w=dom.window,d=w.document,errors=[],downloads=[];
if(process.env.BLOCKOUT_WORKER)require('./worker_test_shim.cjs')(w,root);
w.addEventListener('error',e=>{errors.push(e.error);console.error('DOM ERROR',e.error)});
w.requestAnimationFrame=()=>1;w.cancelAnimationFrame=()=>{};w.ResizeObserver=class{observe(){}disconnect(){}};
w.ImageData=class{constructor(a,b,c){if(typeof a==='number'){this.width=a;this.height=b;this.data=new w.Uint8ClampedArray(a*b*4)}else{this.data=a;this.width=b;this.height=c}}};
w.Image=class{set src(url){try{const p=PNG.sync.read(Buffer.from(url.split(',')[1],'base64'));this.width=p.width;this.height=p.height;this.pixels=p.data;Promise.resolve().then(()=>this.onload?.());}catch(e){Promise.resolve().then(()=>this.onerror?.(e));}}};
Object.defineProperties(w.HTMLElement.prototype,{clientWidth:{get(){return this.id==='out'?600:900}},clientHeight:{get(){return 700}}});
w.HTMLElement.prototype.getBoundingClientRect=function(){return {x:0,y:0,left:0,top:0,width:this.clientWidth,height:this.clientHeight,right:this.clientWidth,bottom:this.clientHeight}};
w.HTMLCanvasElement.prototype.setPointerCapture=()=>{};
const gl=new Proxy({getShaderParameter:()=>true,getProgramParameter:()=>true,getAttribLocation:()=>0,getUniformLocation:()=>({}),getParameter:()=>8192},{get(o,k){if(k in o)return o[k];if(/^[A-Z_0-9]+$/.test(k))return 1;return ()=>({});}});
const pixels=c=>{if(!c.pixels||c.pixels.length!==c.width*c.height*4)c.pixels=new w.Uint8ClampedArray(c.width*c.height*4);return c.pixels};
w.HTMLCanvasElement.prototype.getContext=function(kind){if(kind==='webgl2')return gl;const c=this;if(c.ctx)return c.ctx;return c.ctx=new Proxy({canvas:c,getImageData(x,y,width,height){const img=new w.ImageData(width,height),src=pixels(c);for(let j=0;j<height;j++)for(let i=0;i<width;i++)img.data.set(src.subarray(((j+y)*c.width+i+x)*4,((j+y)*c.width+i+x)*4+4),(j*width+i)*4);return img},putImageData(img,x=0,y=0){const dst=pixels(c);for(let j=0;j<img.height;j++)dst.set(img.data.subarray(j*img.width*4,(j+1)*img.width*4),((j+y)*c.width+x)*4)},drawImage(img){if(img.pixels&&img.width===c.width&&img.height===c.height)pixels(c).set(img.pixels)},measureText(t){return {width:t.length*7}},createLinearGradient(){return {addColorStop(){}}},createPattern(){return {}}},{get(o,k){return k in o?o[k]:()=>{}}});};
w.HTMLCanvasElement.prototype.toDataURL=function(){return 'data:image/png;base64,'+PNG.sync.write({width:this.width,height:this.height,data:Buffer.from(pixels(this))}).toString('base64')};
w.HTMLCanvasElement.prototype.toBlob=function(cb){cb(new w.Blob([PNG.sync.write({width:this.width,height:this.height,data:Buffer.from(pixels(this))})],{type:'image/png'}))};
w.URL.createObjectURL=blob=>{downloads.push(blob);return 'blob:test'};w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=function(){downloads.push(this.download)};
for(const script of [...d.querySelectorAll('script[src]')])w.eval(fs.readFileSync(path.join(root,script.getAttribute('src')),'utf8')+'\n//# sourceURL='+script.getAttribute('src'));
const plain=x=>JSON.parse(JSON.stringify(x)),flush=()=>new Promise(r=>setTimeout(r,10));let count=0;
async function check(name,fn){await fn();count++;console.log('PASS '+name)}
function key(key,code,opts={}){d.getElementById('view').dispatchEvent(new w.KeyboardEvent('keydown',{key,code,bubbles:true,cancelable:true,...opts}))}
function pointer(type,p,opts={}){const e=new w.MouseEvent(type,{clientX:p[0],clientY:p[1],button:0,bubbles:true,cancelable:true,...opts});Object.defineProperties(e,{pointerId:{value:1},pointerType:{value:'mouse'}});d.getElementById('view').dispatchEvent(e)}
const bounds=o=>[0,1,2].map(k=>[Math.min(...o.verts.map(v=>v[k])),Math.max(...o.verts.map(v=>v[k]))]);
(async()=>{
 await flush();assert.equal(errors.length,0);const A=w.TS.api,S=A.state;
 async function open(p){const promise=A.openProject(typeof p==='string'?p:JSON.stringify(p));await flush();if(d.getElementById('ask').classList.contains('open'))d.getElementById('ask_discard').click();return promise;}
 await check('app boots; Add retains its original primitives and has no blockout presets',()=>{assert.ok(A.renderer&&A.output);assert.ok(d.getElementById('b_blockout_new').onclick);assert.equal(d.querySelector('[data-kind^="blockout-"]'),null);});
 await check('new blank blockout starts in iso26 with Color preview',async()=>{await A.newBlockout();assert.equal(S.settings.projection,'iso');assert.equal(S.settings.isoTilt,26);assert.equal(S.settings.blockout,true);assert.equal(A.output.mode,'blockout');assert.equal(S.snap,8);assert.equal(S.art.w,1024);});
 await check('ordinary Add creates colored objects; Properties recoloring supports undo/redo',()=>{
  for(const t of ['box','cylinder','wedge','plane','sphere']){d.querySelector(`[data-kind="${t}"]`).click();assert.equal(S.objects.at(-1).blockoutColor,d.getElementById('draw_color').value);}assert.equal(S.objects.length,5);
  const color=d.getElementById('p_blockcolor');color.value='#1234ab';color.dispatchEvent(new w.Event('change'));assert.equal(S.objects.at(-1).blockoutColor,'#1234ab');A.undo();assert.notEqual(S.objects.at(-1).blockoutColor,'#1234ab');A.redo();assert.equal(S.objects.at(-1).blockoutColor,'#1234ab');A.processNow();assert.ok(S.result.stats.covered>0);A.redraw();
 });
 await check('new blockout cancel preserves scene; discard asks only once',async()=>{
  const before=A.projectJSON(),n=A.newBlockout();await flush();assert.ok(d.getElementById('ask').classList.contains('open'));d.getElementById('ask_cancel').click();await n;assert.equal(A.projectJSON(),before);
  const n2=A.newBlockout();await flush();d.getElementById('ask_discard').click();await n2;assert.equal(S.objects.length,0);assert.ok(!d.getElementById('ask').classList.contains('open'));
 });
 await check('Free Draw follows iso floor; wheel zoom and bracket depth are independent',()=>{
  S.cursor=[0,0,0];S.snap=8;d.getElementById('pencil_snap').checked=true;d.getElementById('pencil_surface').checked=false;d.getElementById('pencil_mode').value='box';d.getElementById('pencil_plane').value='top';d.getElementById('pencil_thickness').value='16';
  A.setTool('pencil');A.redraw();assert.equal(A.pencil.local,true);assert.equal(!!A.pencil.view3d,false);
  const a=A.renderer.toScreen([32,32,0]),b=A.renderer.toScreen([96,64,0]);pointer('pointerdown',a);pointer('pointermove',b);pointer('pointerup',b);assert.ok(A.pencil.preview,d.getElementById('status').textContent);assert.deepEqual(plain(bounds(A.pencil.preview.object)),[[32,96],[32,64],[0,16]]);
  key('}','BracketRight',{shiftKey:true});assert.equal(Number(d.getElementById('pencil_thickness').value),16.1);const z=A.renderer.cam.zoom;
  d.getElementById('view').dispatchEvent(new w.WheelEvent('wheel',{deltaY:-100,clientX:b[0],clientY:b[1],bubbles:true,cancelable:true}));assert.notEqual(A.renderer.cam.zoom,z);assert.equal(Number(d.getElementById('pencil_thickness').value),16.1);
  d.getElementById('draw_color').value='#fd6048';d.getElementById('draw_color').dispatchEvent(new w.Event('input'));key('Enter','Enter');assert.equal(S.objects.length,1);assert.equal(S.objects[0].blockoutColor,'#fd6048');assert.equal(A.pencil.pts.length,0);A.undo();assert.equal(S.objects.length,0);A.redo();assert.equal(S.objects.length,1);
 });
 await check('isometric Free Draw detects a wall plane; Cut Through keeps color and undo',()=>{
  A.setTool('select');const wall=w.TS.Mesh.box([192,40,0],64,16,64);wall.blockoutColor='#42aacc';S.objects.push(wall);A.changed();A.redraw();
  d.getElementById('pencil_surface').checked=true;d.getElementById('pencil_thickness').value='8';A.setTool('pencil');
  const a=A.renderer.toScreen([168,48,16]),b=A.renderer.toScreen([184,48,40]);pointer('pointerdown',a);pointer('pointermove',b);pointer('pointerup',b);assert.ok(A.pencil.preview,d.getElementById('status').textContent);assert.ok(Math.abs(A.pencil.anchor.normal[1]-1)<1e-6);
  const bb=bounds(A.pencil.preview.object);bb.forEach((axis,k)=>axis.forEach((n,j)=>assert.ok(Math.abs(n-[[168,184],[48,56],[16,40]][k][j])<1e-3)));key('Enter','Enter');
  d.getElementById('pencil_operation').value='cut';d.getElementById('pencil_operation').dispatchEvent(new w.Event('change'));const c=A.renderer.toScreen([200,48,8]),e=A.renderer.toScreen([216,48,24]),oldVolume=w.TS.Carve.volume(wall);
  pointer('pointerdown',c);pointer('pointermove',e);pointer('pointerup',e);assert.ok(A.pencil.preview,d.getElementById('status').textContent);assert.equal(A.pencil.targetId,wall.id);key('Enter','Enter');
  const cut=S.objects.find(o=>o.id===wall.id);assert.ok(w.TS.Carve.volume(cut)<oldVolume);assert.equal(cut.blockoutColor,'#42aacc');A.undo();assert.ok(Math.abs(w.TS.Carve.volume(S.objects.find(o=>o.id===wall.id))-oldVolume)<1e-3);
  d.getElementById('pencil_operation').value='add';A.setTool('select');
 });
 await check('project roundtrip embeds current procedural PNG with editable objects and mode',async()=>{
  A.setTool('select');const saved=A.projectJSON(),p=JSON.parse(saved);assert.equal(p.settings.blockout,true);const source=PNG.sync.read(Buffer.from(p.tileset.split(',')[1],'base64'));assert.ok(source.data.some(v=>v>0));assert.equal(p.tileset,S.artURL);await open(saved);assert.deepEqual(plain(S.objects),p.objects);assert.equal(A.output.mode,'blockout');assert.equal(d.getElementById('blockout_mode').checked,true);
 });
 await check('browser bundle and transparent PNG contain generated colors',async()=>{
  const bundle=JSON.parse(await A.bundleJSON()),png=PNG.sync.read(Buffer.from(bundle.images.atlas.split(',')[1],'base64'));assert.ok(png.data.some(v=>v>0));assert.ok(png.data.some((v,i)=>i%4===3&&v===0));assert.equal(bundle.projection.tilt,26);await A.exportBlockoutPNG();assert.ok(downloads.some(x=>typeof x==='string'&&x.endsWith('_blockout.png')));
 });
 await check('turning Blockout off retains generated PNG; undoing initial enable restores painted source',async()=>{
  const c=d.createElement('canvas');c.width=c.height=128;pixels(c).set([90,120,150,255]);const source=c.toDataURL();await open({format:'tileset-studio',name:'painted',tileset:source,objects:[],settings:{projection:'iso',isoTilt:26,isoOrigin:[64,40]}});assert.equal(S.settings.blockout,false);
  A.setBlockout(true);assert.notEqual(S.artURL,source);A.undo();assert.equal(S.artURL,source);assert.deepEqual(Array.from(S.art.data.slice(0,4)),[90,120,150,255]);A.redo();assert.equal(S.settings.blockout,true);
  S.cursor=[0,0,0];A.addPrimitive('box');const baked=JSON.parse(A.projectJSON()).tileset;assert.notEqual(baked,source);assert.ok(S.art.alpha.some(v=>v>0));
  const incoming=new w.ImageData(128,128);incoming.data.set([255,255,255,255]);await w.TS.Link.onAlbedo(incoming);
  A.setBlockout(false);assert.equal(S.artURL,baked);assert.equal(A.output.mode,'lit');assert.equal(JSON.parse(await A.bundleJSON()).images.atlas,baked);
  A.undo();assert.equal(S.settings.blockout,true);assert.equal(A.output.mode,'blockout');A.redo();assert.equal(S.settings.blockout,false);assert.equal(A.output.mode,'lit');assert.equal(S.artURL,baked);
  A.addPrimitive('box');assert.equal(S.objects.at(-1).blockoutColor,undefined);assert.equal(S.settings.blockout,false);assert.equal(S.artURL,baked);assert.equal(d.getElementById('blockout_color_control').hidden,true);assert.equal(d.getElementById('p_blockcolor'),null);
 });
 await check('normal-mode Free Draw also creates no procedural color',()=>{
  S.cursor=[0,0,0];d.getElementById('pencil_surface').checked=false;d.getElementById('pencil_mode').value='box';d.getElementById('pencil_plane').value='top';d.getElementById('pencil_thickness').value='8';A.setTool('pencil');A.redraw();
  const n=S.objects.length,a=A.renderer.toScreen([8,8,0]),b=A.renderer.toScreen([24,24,0]);pointer('pointerdown',a);pointer('pointermove',b);pointer('pointerup',b);assert.ok(A.pencil.preview);key('Enter','Enter');assert.equal(S.objects.length,n+1);assert.equal(S.objects.at(-1).blockoutColor,undefined);
 });
 await check('auto source refresh works with Auto processing off; saves and mode switches flush pending edits',async()=>{
  A.setTool('select');A.setBlockout(true);S.autoProcess=false;A.select(S.objects[0].id);
  let before=S.artURL;const color=d.getElementById('p_blockcolor');color.value='#12ee73';color.dispatchEvent(new w.Event('change'));await new Promise(r=>setTimeout(r,350));assert.notEqual(S.artURL,before);
  before=S.artURL;const x=d.getElementById('p_x');x.value='64';x.dispatchEvent(new w.Event('change'));const saved=JSON.parse(A.projectJSON());assert.notEqual(saved.tileset,before);assert.equal(saved.tileset,S.artURL);
  const position=plain(S.settings.isoOrigin),cursor=plain(S.cursor);const c2=d.getElementById('p_blockcolor');c2.value='#44aaff';c2.dispatchEvent(new w.Event('change'));A.setBlockout(false);assert.notEqual(S.artURL,saved.tileset);assert.deepEqual(plain(S.settings.isoOrigin),position);assert.deepEqual(plain(S.cursor),cursor);
  const frozen=S.artURL;A.addPrimitive('cylinder');A.processNow();assert.equal(S.artURL,frozen);A.undo();assert.equal(S.artURL,frozen);
  A.setBlockout(true);before=JSON.parse(A.projectJSON()).tileset;key('a','KeyA');key('Delete','Delete');assert.equal(S.objects.length,0);const empty=PNG.sync.read(Buffer.from(JSON.parse(A.projectJSON()).tileset.split(',')[1],'base64'));assert.ok(empty.data.every(v=>v===0));
  A.undo();assert.equal(S.artURL,before);A.redo();assert.ok(S.art.alpha.every(v=>v===0));S.autoProcess=true;
 });

 if(process.env.BLOCKOUT_WORKER) await check('worker colors match CPU; stale results cannot overwrite a mode change',async()=>{
  A.setTool('select');S.autoProcess=false;A.setBlockout(true);A.addPrimitive('box');
  const waitWorker=async()=>{for(let i=0;i<200&&A.workerBusy;i++)await flush();assert.equal(A.workerBusy,false);};
  A.processInBackground();await waitWorker();assert.ok(A.workerOn);assert.equal(S.result.blockout,true);
  const expected=w.TS.Blockout.process(S.objects,S.art,S.settings);assert.deepEqual(Array.from(S.art.data),Array.from(expected.art.data));
  assert.deepEqual(Array.from(pixels(A.output.off)),Array.from(S.art.data));
  S.objects[0].blockoutColor='#fa1643';A.changed();A.processInBackground();
  A.setBlockout(false);const frozen=S.artURL;await waitWorker();assert.equal(S.artURL,frozen);assert.ok(!S.result.blockout);
  A.processInBackground();await waitWorker();assert.ok(!S.result.blockout);assert.equal(S.artURL,frozen);
 });
 assert.equal(errors.length,0);console.log(`\n${count} simulated-browser checks passed. Canvas/WebGL calls mocked; not visual GPU validation.`);dom.window.close();
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1});
