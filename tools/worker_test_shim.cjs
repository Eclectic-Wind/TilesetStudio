// Execute the actual browser worker code in an isolated VM with structured-clone transfers.
// This exercises its protocol and raster logic; it does not test browser scheduling or WebGL.
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
module.exports=(w,root)=>{
 w.Worker=class {
  constructor(url){
   const self=this,ctx={console};ctx.self=ctx;
   ctx.importScripts=(...names)=>names.forEach(n=>vm.runInContext(fs.readFileSync(path.join(root,'js',n),'utf8'),ctx,{filename:n}));
   ctx.postMessage=(data,transfer)=>{const copy=structuredClone(data,{transfer});setTimeout(()=>self.onmessage?.({data:copy}),0)};
   vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(root,url),'utf8'),ctx,{filename:url});this.ctx=ctx;
  }
  postMessage(data){const copy=structuredClone(data);setTimeout(()=>{try{this.ctx.onmessage({data:copy})}catch(error){this.onerror?.(error);}},10)}
 };
};
